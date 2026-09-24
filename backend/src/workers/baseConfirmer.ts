import { prisma } from '../lib/db';
import { config } from '../lib/config';
import { baseRelayQueue } from '../lib/queues';
import { baseService, RevertClass } from '../services/baseService';
import { megapotService } from '../services/megapotService';
import { onShutdown } from '../lib/shutdown';

/**
 * The CONFIRMER — second half of the submit/confirm split.
 *
 * The relay worker broadcasts and walks away (fast lane). This loop owns
 * everything that happens after the mempool:
 *   - receipt confirmed  → SUCCESS + Megapot ticket IDs
 *   - mined but reverted → classify → retry / permanent / recover-already-processed
 *   - dropped from pool  → resync nonce lane, bounce to retry
 * It is also the sweep for BASE_SUBMITTED orders stranded by crashes/redeploys,
 * which closes the old "black hole" where those rows were never touched again.
 * All transitions are guarded updateMany calls, so multiple processes running
 * this loop (inline + standalone worker) stay idempotent.
 */

const POLL_MS = 5_000;                 // 5 secs
const PENDING_TIMEOUT_MS = 2 * 60_000; // 2 minutes
const BATCH_SIZE = 50;

interface OrderForFinalize {
  hash: string;
  tickets: { id: string }[];
}

interface SubmittedOrder extends OrderForFinalize {
  baseTxHash: string | null;
  attemptCount: number;
  updatedAt: Date;
}

/** Shared success finalizer — used here and by the relay worker's recovery path. */
export async function finalizeOrderSuccess(
  order: OrderForFinalize,
  txHash: string,
  ticketIds: bigint[]
): Promise<void> {
  const round = await megapotService.getRoundState();

  await prisma.$transaction(async (tx) => {
    const res = await tx.relayOrder.updateMany({
      where: {
        hash: order.hash,
        status: { in: ['BASE_SUBMITTED', 'PROCESSING', 'RETRY_PENDING'] },
      },
      data: {
        status: 'SUCCESS',
        baseTxHash: txHash,
        fulfillEpoch: round?.id ?? null,
        // FIX: Convert the massive BigInts to strings
        megapotTicketIds: ticketIds.map(id => id.toString()), 
        lastError: null,
        nextRetryAt: null,
      },
    });
    
    if (res.count === 0) {
      console.log(`[finalizer] Order ${order.hash.slice(0,10)} already finalized by another process`);
      return;
    }

    for (let i = 0; i < order.tickets.length; i++) {
      if (ticketIds[i] !== undefined) {
        await tx.ticket.update({
          where: { id: order.tickets[i].id },
          data: { megapotNftId: ticketIds[i].toString() },
        });
      }
    }
  });
}

async function bounceToRetry(order: SubmittedOrder, reason: string): Promise<void> {
  const attemptNum = order.attemptCount + 1;
  const backoff = Math.min(
    config.relay.baseBackoffMs * 2 ** attemptNum,
    config.relay.maxBackoffMs
  );

  const res = await prisma.relayOrder.updateMany({
    where: { hash: order.hash, status: 'BASE_SUBMITTED' },
    data: {
      status: 'RETRY_PENDING',
      lastError: reason.slice(0, 2000),
      attemptCount: { increment: 1 },
      nextRetryAt: new Date(Date.now() + backoff),
    },
  });
  if (res.count === 0) return;

  await prisma.relayAttempt.create({
    data: {
      orderHash: order.hash,
      attemptNum,
      baseTxHash: order.baseTxHash,
      error: reason.slice(0, 2000),
    },
  });

  // Fresh jobId per attempt: BullMQ retains completed jobs, so re-adding the
  // original `relay-${hash}` id would silently dedupe and the retry never runs.
  await baseRelayQueue.add(
    'relay-to-base',
    { hash: order.hash },
    { jobId: `relay-${order.hash}-r${attemptNum}`, delay: backoff }
  );

  console.log(`[confirmer] Order ${order.hash.slice(0, 10)}… bounced to RETRY_PENDING: ${reason.slice(0, 120)}`);
}

/** Re-simulate a mined-but-reverted tx at latest state to extract the revert reason. */
export async function classifyMinedRevert(txHash: string): Promise<RevertClass> {

  const provider = baseService.getProvider();
  const tx = await provider.getTransaction(txHash);    // * eth_getTransactionByHash

  // since the flow reached here only if receipt is 0, it means the tx did exist in the blockchain but reverted.
  // so !tx, would indicate : You got the receipt from one backend node, but getTransaction hit a different node that hasn't caught up yet.
  // so !tx.to, would indicate : the tx did exist but This transaction is a Contract Creation (Deployment) transaction.
  if (!tx || !tx.to) {
    return { kind: 'transient', reason: 'Reverted tx unavailable for re-simulation' };
  }

  try {
    // If the order was meanwhile fulfilled by another tx, this correctly
    // comes back as OrderAlreadyProcessed → recovery path, not a retry loop.
    await provider.call({ to: tx.to, from: tx.from, data: tx.data });
    return { kind: 'transient', reason: 'Tx reverted on-chain but simulates clean now — retrying' };
  } catch (err) {
    return baseService.classifyError(err);
  }
}

// -> here `SubmittedOrder` is a subset of RelayOrder[], but we are passing order as RelayOrder from `runConfirmerTick()` -- type Mismatch
async function confirmOne(order: SubmittedOrder): Promise<void> {

  const provider = baseService.getProvider();
  const ageMs = Date.now() - order.updatedAt.getTime();

  if (!order.baseTxHash) {
    // Crash landed between broadcast and the DB write (or legacy row).
    // The retry is safe: estimateGas reverts OrderAlreadyProcessed if the lost
    // tx actually made it, and the recovery path finds the original receipt.
    if (ageMs > PENDING_TIMEOUT_MS) { // 2 mins
      await bounceToRetry(order, 'BASE_SUBMITTED without txHash — resetting for safe retry');
    }
    return;
  }

  const receipt = await provider.getTransactionReceipt(order.baseTxHash);  // * eth_getTransactionReceipt
  // !receipt : Still waiting in the mempool (normal case) || Was dropped / replaced from Mempool (bad case)
  if (!receipt) {
    if (ageMs < PENDING_TIMEOUT_MS) return; // still propagating/mining — normal

    const stillInMempool = await provider.getTransaction(order.baseTxHash); // * eth_getTransactionByHash
    
    if (stillInMempool) {
      // Alive but slow — likely underpriced. Fee-bumping (same-nonce replacement
      // at +15% fee) is the designed follow-up; do not double-submit here.
      console.warn(`[confirmer] Tx ${order.baseTxHash} pending > ${PENDING_TIMEOUT_MS / 1000}s — leaving in place (fee-bump TODO).`);
      return;
    }

    // Vanished: dropped from the mempool. Its nonce may have left a gap —
    // resync the lane, then retry the order as a brand-new tx.
    baseService.resetNonceLane();
    await bounceToRetry(order, 'Broadcast tx dropped from mempool — resubmitting');
    return;
  }

  if (receipt.status === 1) {
    const ticketIds = baseService.parseTicketIdsFromReceipt(receipt);
    await finalizeOrderSuccess(order, receipt.hash, ticketIds); // -> here order is expected of type : OrderForFinalize, but is actually of type : SubmittedOrder
    console.log(`[confirmer] ✅ Order ${order.hash.slice(0, 10)}… confirmed in block ${receipt.blockNumber} — ${ticketIds.length} Megapot ticket ID(s)`);
    return;
  }

  // Mined but reverted: nonce consumed (sequence unaffected), order NOT fulfilled.
  const cls = await classifyMinedRevert(order.baseTxHash);

  if (cls.kind === 'already_processed') {
    const existing = await baseService.findExistingFulfillment(order.hash);
    if (existing) {
      await finalizeOrderSuccess(order, existing.txHash, existing.ticketIds);
      console.log(`[confirmer] ✅ Order ${order.hash.slice(0, 10)}… recovered from earlier fulfillment ${existing.txHash}`);
      return;
    }
    await bounceToRetry(order, 'Revert says already processed, but fulfillment event not found yet');
    return;
  }

  if (cls.kind === 'permanent') {
    const res = await prisma.relayOrder.updateMany({
      where: { hash: order.hash, status: 'BASE_SUBMITTED' },
      data: {
        status: 'FAILED_PERMANENT',
        lastError: cls.reason.slice(0, 2000),
        attemptCount: { increment: 1 },
        nextRetryAt: null,
      },
    });
    if (res.count > 0) {
      await prisma.relayAttempt.create({
        data: {
          orderHash: order.hash,
          attemptNum: order.attemptCount + 1,
          baseTxHash: order.baseTxHash,
          error: cls.reason.slice(0, 2000),
        },
      });
    }
    console.error(`[confirmer] ⛔ Order ${order.hash.slice(0, 10)}… FAILED_PERMANENT: ${cls.reason}`);
    return;
  }

  // paused / transient — retry later; reconciler defers if protocol is paused
  await bounceToRetry(order, cls.reason);
}

export async function runConfirmerTick(): Promise<void> {

  const orders = await prisma.relayOrder.findMany({
    where: { status: 'BASE_SUBMITTED' },
    include: { tickets: true },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
  });

  for (const order of orders) {
    try {
      await confirmOne(order);
    } catch (err) {
      console.error(`[confirmer] Error confirming order ${order.hash}:`, err);
    }
  }

}



let intervalId : NodeJS.Timeout | null = null;
let tickInFlight = false;

export function startBaseConfirmer(): void {
  
  if (intervalId) return; // singleton per process

  // `intervalId` is assigned immediately when `setInterval()` is called — before the first tick even runs.
  intervalId = setInterval(() => {                                      // This line runs RIGHT NOW
    
    if (tickInFlight) return;   // This is a good guard so that even if one tick takes longer than 5s, the next one doesn't start

    tickInFlight = true;
    
    runConfirmerTick()                                                  // This runs LATER (after every 5 secs)
      .catch((err) => console.error('[confirmer] Tick failed:', err))
      .finally(() => { tickInFlight = false; });
    }, POLL_MS);

  onShutdown('base-confirmer', () => {
    if (intervalId) clearInterval(intervalId);
  });

  console.log(`[confirmer] Base receipt confirmer online (every ${POLL_MS / 1000}s)`);

}
