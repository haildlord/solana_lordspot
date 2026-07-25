import { prisma } from '../lib/db';
import { redisConnection } from '../lib/redis';
import { baseService } from '../services/baseService';
import { onShutdown } from '../lib/shutdown';

/**
 * The HARVEST worker — pulls settled winnings out of Megapot into the Base
 * vault, one batched claimWinnings() per chunk of winning tickets.
 *
 * Pipeline position: settlement grades tickets (WON_* / LOST) → THIS moves
 * the money for WON_* tickets (winStatus → CLAIMED_ON_BASE) → the claims API
 * pays users on Solana from the vault float (PAID_OUT_ON_SOLANA).
 *
 * Watermarks, same idiom as settlement: an epoch owes harvest work while
 * ticketsSettledAt IS NOT NULL AND ticketsHarvestedAt IS NULL. Every batch is
 * a durable HarvestBatch row (tickets bound BEFORE broadcast), so a crash at
 * any point is recoverable by re-reading Postgres + the chain.
 *
 * MONEY-MOVER RULE: this worker broadcasts transactions, so unlike the
 * settlement pass it must run in EXACTLY ONE place. It is started only by the
 * worker process (never the cron), and a Redis lock guards against
 * multi-instance worker deployments double-submitting.
 *
 * One batch in flight at a time, confirmed inline on the next tick — harvest
 * is a once-per-epoch background job; latency is irrelevant, correctness is
 * everything (no submit/confirm split needed).
 */

const POLL_MS = 60_000;
const CHUNK_SIZE = 50; // ~46% gas savings vs singles already at this size; keeps the all-or-nothing blast radius small
const PENDING_TIMEOUT_MS = 2 * 60_000;
const LOCK_KEY = 'harvest_lock';
const LOCK_TTL_SEC = 300;
const QUARANTINE_KEY = 'harvest:quarantined_ticket_ids';

const HARVESTABLE = ['WON_UNCLAIMED', 'WON_FREE_TICKET'] as const;

interface BatchTicket {
  id: string;
  megapotNftId: string | null;
  winAmount: bigint;
}

/** Tickets of one epoch still needing harvest (excluding quarantined ones). */
async function findHarvestableTickets(megapotId: number, quarantined: Set<string>): Promise<BatchTicket[]> {
  const tickets = await prisma.ticket.findMany({
    where: {
      winStatus: { in: [...HARVESTABLE] },
      harvestBatchId: null,
      megapotNftId: { not: null },
      relayOrder: { fulfillEpoch: megapotId, status: 'SUCCESS' },
    },
    select: { id: true, megapotNftId: true, winAmount: true },
    take: CHUNK_SIZE * 2, // headroom so quarantine-filtering still fills a chunk
  });
  return tickets.filter((t) => !quarantined.has(t.id));
}

/**
 * Megapot's claim loop is all-or-nothing: ONE bad id reverts the whole batch.
 * estimateGas is the free rehearsal — on failure, bisect to isolate exactly
 * which ids are unclaimable, at zero gas cost.
 */
async function bisectClaimable(tickets: BatchTicket[]): Promise<{ good: BatchTicket[]; bad: BatchTicket[] }> {
  if (tickets.length === 0) return { good: [], bad: [] };
  try {
    await baseService.estimateClaimGas(tickets.map((t) => BigInt(t.megapotNftId!)));
    return { good: tickets, bad: [] };
  } catch {
    if (tickets.length === 1) return { good: [], bad: tickets };
    const mid = Math.ceil(tickets.length / 2);
    const left = await bisectClaimable(tickets.slice(0, mid));
    const right = await bisectClaimable(tickets.slice(mid));
    return { good: [...left.good, ...right.good], bad: [...left.bad, ...right.bad] };
  }
}

/** Mark a batch's tickets harvested + reconcile totals against the vault event. */
async function finalizeBatchSuccess(
  batch: { id: string; megapotId: number; amountGross: bigint },
  txHash: string,
  harvestedOnChain: bigint | null
): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { harvestBatchId: batch.id, winStatus: { in: [...HARVESTABLE] } },
      data: { winStatus: 'CLAIMED_ON_BASE' },
    }),
    prisma.harvestBatch.update({
      where: { id: batch.id },
      data: { status: 'CONFIRMED', txHash, confirmedAt: new Date(), error: null },
    }),
  ]);

  // Reconciliation: our settlement math (net of the 10% win-share) vs what the
  // chain actually paid. A drift here means REFERRAL_WIN_SHARE_BPS is wrong —
  // scream, don't hide it.
  if (harvestedOnChain !== null && harvestedOnChain !== batch.amountGross) {
    console.error(
      `[ALERT][harvest] Batch ${batch.id} amount mismatch: DB says ${batch.amountGross}, chain paid ${harvestedOnChain}. ` +
      `Check REFERRAL_WIN_SHARE_BPS — user payouts may be mispriced!`
    );
  }
  console.log(`[harvest] ✅ Batch ${batch.id} (epoch ${batch.megapotId}) confirmed — ${txHash}`);
}

/** Release a failed batch's tickets so the next build can retry them. */
async function releaseBatch(batchId: string, reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.updateMany({
      where: { harvestBatchId: batchId },
      data: { harvestBatchId: null },
    }),
    prisma.harvestBatch.update({
      where: { id: batchId },
      data: { status: 'FAILED', error: reason.slice(0, 2000) },
    }),
  ]);
  console.warn(`[harvest] Batch ${batchId} released: ${reason.slice(0, 200)}`);
}

/** Resolve the epoch's in-flight batch. Returns true if still busy (skip building). */
async function resolveInFlightBatch(megapotId: number): Promise<boolean> {

  const batch = await prisma.harvestBatch.findFirst({
    where: { megapotId, status: 'SUBMITTED' },
  });
  
  if (!batch) return false;

  const ageMs = Date.now() - batch.createdAt.getTime();

  // the server probably crashed between creating the database row and sending the actual transaction.
  if (!batch.txHash) {

    // If it is less than 2 minutes old → just return true (meaning "still busy, skip creating new batch").
    if (ageMs < PENDING_TIMEOUT_MS) return true; // * 2 mins
    
    // Go to the database and fetch all the tickets that belong to this batch.
    // We need their NFT IDs to try resubmitting the claim.
    const tickets = await prisma.ticket.findMany({
      where: { harvestBatchId: batch.id },
      select: { id: true, megapotNftId: true, winAmount: true },
    });

    try {
      await baseService.estimateClaimGas(tickets.map((t) => BigInt(t.megapotNftId!)));
      const { txHash } = await baseService.submitClaimWinnings(tickets.map((t) => BigInt(t.megapotNftId!)));
      await prisma.harvestBatch.update({ where: { id: batch.id }, data: { txHash } });
      console.log(`[harvest] Recovered lost batch ${batch.id} — resubmitted as ${txHash}`);
    } catch {
      console.error(`[ALERT][harvest] Batch ${batch.id}: pre-broadcast crash but ids now unclaimable — original tx likely LANDED. Finalizing from DB amounts; verify on Basescan.`);
      await finalizeBatchSuccess(
        { id: batch.id, megapotId: batch.megapotId, amountGross: batch.amountGross },
        'UNKNOWN-recovered-see-alert',
        null
      );
    }
    
    return true;
  }

  const receipt = await baseService.getProvider().getTransactionReceipt(batch.txHash);

  if (!receipt) {
    if (ageMs < PENDING_TIMEOUT_MS) return true; // still mining — normal
    const stillPending = await baseService.getProvider().getTransaction(batch.txHash);
    if (stillPending) return true; // slow but alive
    baseService.resetNonceLane();
    await releaseBatch(batch.id, 'Harvest tx dropped from mempool — will rebuild');
    return true;
  }

  if (receipt.status === 1) {
    await finalizeBatchSuccess(
      { id: batch.id, megapotId: batch.megapotId, amountGross: batch.amountGross },
      receipt.hash,
      baseService.parseHarvestedFromReceipt(receipt)
    );
  } else {
    // Mined but reverted — a batch member became unclaimable between rehearsal
    // and mining. Release; the next build's bisect isolates the culprit.
    await releaseBatch(batch.id, `Harvest tx ${batch.txHash} reverted on-chain`);
  }
  return true;
}

async function harvestEpochStep(epoch: { megapotId: number }): Promise<void> {

  if (await resolveInFlightBatch(epoch.megapotId)) return;

  const quarantined = new Set(await redisConnection.smembers(QUARANTINE_KEY));
  const harvestable = await findHarvestableTickets(epoch.megapotId, quarantined);

  if (harvestable.length === 0) {
    // Nothing left to move. Winners lacking an NFT id can never be harvested
    // automatically — surface them instead of silently watermarking over them.
    const unharvestable = await prisma.ticket.count({
      where: {
        winStatus: { in: [...HARVESTABLE] },
        megapotNftId: null,
        relayOrder: { fulfillEpoch: epoch.megapotId, status: 'SUCCESS' },
      },
    });

    if (unharvestable > 0) {
      console.error(`[ALERT][harvest] Epoch ${epoch.megapotId}: ${unharvestable} winning ticket(s) have no megapotNftId — manual recovery needed. Watermark withheld.`);
      return;
    }

    await prisma.megapotEpoch.update({
      where: { megapotId: epoch.megapotId },
      data: { ticketsHarvestedAt: new Date() },
    });

    console.log(`[harvest] Epoch ${epoch.megapotId} fully harvested — watermark set.`);
    return;
  }

  // Free rehearsal + bisect: never pay gas to discover a bad id.
  const { good, bad } = await bisectClaimable(harvestable.slice(0, CHUNK_SIZE)); // * CHUNK_SIZE : 50

  if (bad.length > 0) {
    await redisConnection.sadd(QUARANTINE_KEY, ...bad.map((t) => t.id));
    console.error(`[ALERT][harvest] Epoch ${epoch.megapotId}: ${bad.length} ticket(s) unclaimable in rehearsal — quarantined for ops review: ${bad.map((t) => t.id).join(', ')}`);
  }

  if (good.length === 0) return;

  const amountGross = good.reduce((sum, t) => sum + t.winAmount, 0n);

  // Durable-first: bind tickets to a batch row BEFORE broadcasting, so a crash
  // at any later point can always reconstruct what was in flight.
  const batch = await prisma.harvestBatch.create({
    data: { megapotId: epoch.megapotId, amountGross },
  });

  const bound = await prisma.ticket.updateMany({
    where: { id: { in: good.map((t) => t.id) }, harvestBatchId: null },
    data: { harvestBatchId: batch.id },
  });

  if (bound.count === 0) {
    await prisma.harvestBatch.delete({ where: { id: batch.id } });
    return; // another pass got them first
  }

  const { txHash } = await baseService.submitClaimWinnings(good.map((t) => BigInt(t.megapotNftId!)));
  await prisma.harvestBatch.update({ where: { id: batch.id }, data: { txHash } });
  console.log(`[harvest] Epoch ${epoch.megapotId}: batch ${batch.id} broadcast (${good.length} tickets, ${amountGross} units) — ${txHash}`);

}

let tickInFlight = false;

export async function runHarvestTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    // Cross-process guard: harvest moves real money — exactly one runner.
    const lock = await redisConnection.set(LOCK_KEY, String(process.pid), 'EX', LOCK_TTL_SEC, 'NX'); // * 300 EX is : 5 minutes
    if (lock === null) return;

    try {
      
      const epochs = await prisma.megapotEpoch.findMany({
        where: { ticketsSettledAt: { not: null }, ticketsHarvestedAt: null },
        orderBy: { megapotId: 'asc' },
        select: { megapotId: true },
      });

      for (const epoch of epochs) {
        await harvestEpochStep(epoch);
      }

    } finally {
      await redisConnection.del(LOCK_KEY).catch(() => {});
    }
  } catch (err) {
    console.error('[harvest] Tick failed:', err);
  } finally {
    tickInFlight = false;
  }
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startHarvestWorker(): void {
  if (intervalHandle) return; // singleton per process

  void runHarvestTick();
  intervalHandle = setInterval(() => void runHarvestTick(), POLL_MS); // * POLL_MS : 1 min

  onShutdown('harvest-worker', () => {
    if (intervalHandle) clearInterval(intervalHandle);
  });

  console.log(`[harvest] Winnings harvest worker online (every ${POLL_MS / 1000}s)`);
}
