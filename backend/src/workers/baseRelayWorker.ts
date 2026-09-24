import { Worker, Job } from 'bullmq';
import { ethers } from 'ethers';
import { OrderStatus } from '../../generated/prisma/client';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/db';
import { config } from '../lib/config';
import { baseService } from '../services/baseService';
import { megapotService } from '../services/megapotService';
import { finalizeOrderSuccess, classifyMinedRevert } from './baseConfirmer';

/**
 * The SUBMITTER — fast half of the submit/confirm split for orders that fit
 * in one Base transaction (<= config.relay.baseTicketChunkSize tickets).
 *
 * Orders larger than that chunk size are handled differently: each chunk is
 * broadcast AND waited-on synchronously, one at a time, inside this same job
 * — see submitAndConfirmChunk() below. That trade-off is deliberate: EIP-7825
 * caps a single Base tx at 16,777,216 gas (this contract needs ~800-824k
 * gas/ticket), so a >chunk-size order was always going to need multiple real
 * transactions; waiting on each one here (rather than fire-and-forget +
 * a separate async confirmer pass) keeps the "which chunks actually landed"
 * bookkeeping trivial and crash-safe, at the cost of a slower job. BullMQ
 * auto-renews the processing lock in the background for as long as this
 * handler is still running, so a multi-minute job is not at risk of being
 * mistaken for a stalled one.
 */

const RELAYABLE: OrderStatus[] = [
  'QUEUED',
  'RETRY_PENDING',
  'DEFERRED',
  'SOLANA_CONFIRMED',
];

const RECEIPT_POLL_MS = 3_000;
const RECEIPT_TIMEOUT_MS = 3 * 60_000; // give up waiting on one chunk's tx after 3 min

interface ChunkTicket {
  id: string;
  normalBalls: number[];
  bonusBall: number;
}

/**
 * The vault's isOrderFulfilled[orderId] guard is per-orderId, not per-order-hash
 * — reusing the order's own hash for every chunk would mean chunk 1 marks it
 * fulfilled and every later chunk of the SAME order reverts with
 * OrderAlreadyProcessed. Each chunk needs its own id.
 *
 * Derived from the sorted ticket ids actually in the chunk (not e.g. a chunk
 * index) so it's stable across retries: if the exact same set of tickets ends
 * up bundled together again after a crash/retry, it gets the same id, and the
 * OrderAlreadyProcessed recovery path below can find and recover a landed-but-
 * lost-track-of tx — the same safety property the single-tx model already had.
 */
function deriveChunkOrderId(chunk: ChunkTicket[]): string {
  const key = chunk.map((t) => t.id).sort().join(',');
  return ethers.keccak256(ethers.toUtf8Bytes(key));
}

/** Bounded poll for a transaction receipt — returns null on timeout, never throws on a plain "still pending". */
async function waitForReceipt(txHash: string) {
  const provider = baseService.getProvider();
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) return receipt;
    await new Promise((r) => setTimeout(r, RECEIPT_POLL_MS));
  }
  return null;
}

/** Marks a batch CONFIRMED and stamps its tickets with the real Megapot ticket ids + this tx hash. */
async function finalizeChunkSuccess(batchId: string, tickets: ChunkTicket[], txHash: string, ticketIds: bigint[]): Promise<void> {
  await prisma.$transaction([
    prisma.relayBatch.update({
      where: { id: batchId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    }),
    ...tickets
      .map((t, i) => (ticketIds[i] !== undefined
        ? prisma.ticket.update({ where: { id: t.id }, data: { megapotNftId: ticketIds[i].toString(), baseTxHash: txHash } })
        : null))
      .filter((op): op is NonNullable<typeof op> => op !== null),
  ]);
}

/** Un-binds a chunk's tickets from a failed/stuck batch so the next pass re-chunks them fresh. */
async function releaseChunk(batchId: string, ticketIds: string[], status: 'FAILED', reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.ticket.updateMany({ where: { id: { in: ticketIds } }, data: { relayBatchId: null } }),
    prisma.relayBatch.update({ where: { id: batchId }, data: { status, error: reason.slice(0, 2000) } }),
  ]);
}

/**
 * A chunk's tx mined but reverted — classify why before giving up on it.
 * OrderAlreadyProcessed specifically means an EARLIER attempt for this exact
 * ticket set already landed (crash between broadcast and this job recording
 * it, or a retry racing an in-flight original) — recover that receipt instead
 * of treating real, already-paid-for tickets as failed. Returns true if
 * recovered (chunk finalized as success), false if genuinely failed (released
 * for the next pass to rebuild).
 */
async function handleChunkRevert(batchId: string, chunk: ChunkTicket[], txHash: string): Promise<boolean> {
  const cls = await classifyMinedRevert(txHash);

  if (cls.kind === 'already_processed') {
    const chunkOrderId = deriveChunkOrderId(chunk);
    const existing = await baseService.findExistingFulfillment(chunkOrderId);
    if (existing) {
      await finalizeChunkSuccess(batchId, chunk, existing.txHash, existing.ticketIds);
      console.log(`[relay] ✅ Recovered batch ${batchId} from an earlier fulfillment — ${existing.txHash}`);
      return true;
    }
    console.error(`[ALERT][relay] Batch ${batchId}: chunk already fulfilled on-chain but its TicketsRouted event couldn't be found — needs ops review.`);
  }

  const reason = cls.kind === 'already_processed' ? 'Already processed, but fulfillment unrecoverable' : cls.reason;
  await releaseChunk(batchId, chunk.map((t) => t.id), 'FAILED', `Tx ${txHash} reverted on-chain (${cls.kind}): ${reason}`);
  return false;
}

/**
 * Any RelayBatch left SUBMITTED from a prior, interrupted run of this job
 * (crash between broadcast and this job returning). Resolved BEFORE building
 * any new chunk, so the same tickets can never end up in two batches at once.
 */
async function resolveInFlightBatches(orderHash: string): Promise<void> {
  const stuck = await prisma.relayBatch.findMany({
    where: { orderHash, status: 'SUBMITTED' },
    include: { tickets: { select: { id: true, normalBalls: true, bonusBall: true } } },
  });

  for (const batch of stuck) {
    if (!batch.txHash) {
      // Crashed between row creation and broadcast — nothing was ever sent.
      await releaseChunk(batch.id, batch.tickets.map((t) => t.id), 'FAILED', 'No txHash — broadcast never completed, releasing for retry');
      continue;
    }

    const receipt = await waitForReceipt(batch.txHash);
    if (!receipt) {
      console.error(`[ALERT][relay] Batch ${batch.id} (order ${orderHash}): tx ${batch.txHash} still unconfirmed after ${RECEIPT_TIMEOUT_MS / 1000}s — releasing tickets for a fresh attempt. Original tx may still land; verify on Basescan before assuming it's lost.`);
      await releaseChunk(batch.id, batch.tickets.map((t) => t.id), 'FAILED', `Tx ${batch.txHash} unconfirmed after timeout`);
      continue;
    }

    if (receipt.status === 1) {
      const ticketIds = baseService.parseTicketIdsFromReceipt(receipt);
      await finalizeChunkSuccess(batch.id, batch.tickets, batch.txHash, ticketIds);
      console.log(`[relay] Recovered in-flight batch ${batch.id} — confirmed in block ${receipt.blockNumber}`);
    } else {
      await handleChunkRevert(batch.id, batch.tickets, batch.txHash);
    }
  }
}

/**
 * Broadcasts one chunk, then waits synchronously for it to confirm. Throws on
 * genuine failure — caller classifies. Uses a per-chunk orderId (NOT the
 * order's own hash — see deriveChunkOrderId) since the vault's
 * isOrderFulfilled guard is per-orderId: reusing the order hash across
 * chunks would make every chunk after the first revert with
 * OrderAlreadyProcessed against the FIRST chunk's own fulfillment.
 */
async function submitAndConfirmChunk(orderHash: string, batchIndex: number, chunk: ChunkTicket[]): Promise<void> {
  const batch = await prisma.relayBatch.create({ data: { orderHash, batchIndex } });
  await prisma.ticket.updateMany({ where: { id: { in: chunk.map((t) => t.id) } }, data: { relayBatchId: batch.id } });

  const chunkOrderId = deriveChunkOrderId(chunk);
  const formattedChunk = chunk.map((t) => ({ normals: t.normalBalls, bonusball: t.bonusBall }));
  // source stays the parent order's hash — telemetry only (TicketPurchased's
  // `source` field), so all of one order's chunks still group together there.
  const { txHash } = await baseService.submitBuyTickets({ orderId: chunkOrderId, tickets: formattedChunk, source: orderHash });
  await prisma.relayBatch.update({ where: { id: batch.id }, data: { txHash } });

  console.log(`[relay] Batch ${batch.id} (order ${orderHash.slice(0, 10)}…, ${chunk.length} ticket(s)) broadcast — ${txHash}`);

  const receipt = await waitForReceipt(txHash);
  if (!receipt) {
    await releaseChunk(batch.id, chunk.map((t) => t.id), 'FAILED', `Tx ${txHash} unconfirmed after timeout`);
    throw new Error(`Batch ${batch.id} tx ${txHash} did not confirm in time`);
  }

  if (receipt.status !== 1) {
    const recovered = await handleChunkRevert(batch.id, chunk, txHash);
    if (recovered) return;
    throw new Error(`Batch ${batch.id} tx ${txHash} reverted on-chain`);
  }

  const ticketIds = baseService.parseTicketIdsFromReceipt(receipt);
  await finalizeChunkSuccess(batch.id, chunk, txHash, ticketIds);
  console.log(`[relay] ✅ Batch ${batch.id} confirmed in block ${receipt.blockNumber}`);
}

export const baseRelayWorker = new Worker(
  'relay-to-base',
  async (job: Job<{ hash: string }>) => {
    const { hash } = job.data;
    console.log(`\n[WORKER:relay-to-base] Started processing job ${job.id} for hash: ${hash}`);

    if (!hash) {
      console.error(`[WORKER:relay-to-base] Fatal Error: Job ${job.id} missing hash payload.`);
      return;
    }

    const order = await prisma.relayOrder.findUnique({
      where: { hash },
      include: { tickets: true },
    });

    if (!order) {
      console.warn(`[WORKER:relay-to-base] Job ${job.id} aborted: No order found for hash ${hash}`);
      return;
    }

    if (order.status === 'BASE_SUBMITTED') {
      console.log(`[WORKER:relay-to-base] Order ${hash} already broadcast — confirmer owns it. Skipping.`);
      return;
    }

    if (!RELAYABLE.includes(order.status)) {
      console.log(`[WORKER:relay-to-base] Job ${job.id} skipped: Order status '${order.status}' is not relayable.`);
      return;
    }

    // NOTE: retry TIMING is owned by BullMQ backoff alone (single clock).
    // nextRetryAt is written as information for the reconciler, never used as a gate here.

    // Epoch / pause gate
    const round = await megapotService.getActiveRound();
    if (megapotService.isRoundLocked(round) || (await megapotService.isProtocolPaused())) {
      console.log(`[WORKER:relay-to-base] Protocol paused or round locked. Deferring order ${hash}.`);
      await prisma.relayOrder.update({
        where: { hash },
        data: { status: 'DEFERRED', lastError: 'Megapot locked or protocol paused' },
      });
      return;
    }

    // Vault solvency — Redis-cached circuit breaker. Chain reads happen in
    // vaultMonitor every 5 min, NOT per order. One refresh is allowed here when
    // the cache looks too small, so a stale/over-debited cache can't false-block.
    let balance = await baseService.getCachedVaultUsdcBalance();

    if (balance < order.amountUsdc) {
      try {
        balance = await baseService.refreshVaultBalanceCache();
      } catch {
        console.log("[SERVICE:base] : RPC failed to fetch the Vault USDC balance");
       }
    }

    if (balance < order.amountUsdc) {

      console.error(`[SERVICE:base] Insufficient Vault funds! Have ${balance}, need ${order.amountUsdc}`);

      await prisma.relayOrder.update({
        where: { hash },
        data: {
          status: 'RETRY_PENDING',
          lastError: `Insufficient Base vault USDC: have ${balance}, need ${order.amountUsdc}`,
          nextRetryAt: new Date(Date.now() + 60_000),
          attemptCount: { increment: 1 },
        },
      });

      throw new Error('Base vault underfunded'); // BullMQ retry + alert ops
    }

    // Optimistic lock
    const locked = await prisma.relayOrder.updateMany({
      where: { hash, status: { in: RELAYABLE } },
      data: { status: 'PROCESSING' },
    });

    if (locked.count === 0) {
      console.warn(`[DATABASE] Lock acquisition failed. Order ${hash} taken by another worker.`);
      return;
    }

    const attemptNum = order.attemptCount + 1;

    try {

      // Resolve anything left mid-flight by a previous, interrupted run of
      // this same order BEFORE building any new chunk from it.
      await resolveInFlightBatches(hash);

      const pendingTickets = await prisma.ticket.findMany({
        where: { orderHash: hash, megapotNftId: null, relayBatchId: null },
        select: { id: true, normalBalls: true, bonusBall: true },
      });

      if (pendingTickets.length > 0) {
        const chunkSize = config.relay.baseTicketChunkSize;
        const existingBatchCount = await prisma.relayBatch.count({ where: { orderHash: hash } });

        console.log(`[SERVICE:base] Broadcasting ${pendingTickets.length} ticket(s) for order ${hash.slice(0, 10)}… in chunks of ${chunkSize} (Attempt: ${attemptNum})...`);

        for (let i = 0; i < pendingTickets.length; i += chunkSize) {
          const chunk = pendingTickets.slice(i, i + chunkSize);
          const batchIndex = existingBatchCount + Math.floor(i / chunkSize);
          await submitAndConfirmChunk(hash, batchIndex, chunk);
        }
      }

      // Every ticket now has a megapotNftId — the whole order is done.
      const allTicketIds = (
        await prisma.ticket.findMany({ where: { orderHash: hash }, select: { megapotNftId: true } })
      )
        .map((t) => t.megapotNftId)
        .filter((id): id is string => id !== null);

      await prisma.relayOrder.update({
        where: { hash },
        data: {
          status: 'SUCCESS',
          fulfillEpoch: round?.id ?? null,
          megapotTicketIds: allTicketIds,
          lastError: null,
          nextRetryAt: null,
        },
      });

      await baseService.debitVaultBalanceCache(order.amountUsdc);

      console.log(`[RELAY] ✅ Order ${hash.slice(0, 10)}… fully confirmed across ${Math.ceil(order.tickets.length / config.relay.baseTicketChunkSize)} batch(es).`);
      return;

    } catch (err: any) {
      const cls = baseService.classifyError(err);

      if (cls.kind === 'already_processed') {
        // An earlier broadcast (crash recovery / duplicate delivery) already
        // fulfilled this order's tickets on-chain under the OLD single-tx
        // model. Recover the original receipt instead of burning gas on a
        // doomed tx — this path only applies to orders that predate chunking.
        console.warn(`[RELAY] Order ${hash.slice(0, 10)}… already fulfilled on-chain. Recovering original receipt...`);
        const existing = await baseService.findExistingFulfillment(hash);
        if (existing) {
          await finalizeOrderSuccess(
            { hash, tickets: order.tickets },
            existing.txHash,
            existing.ticketIds
          );
          console.log(`[RELAY] ✅ Recovered fulfillment for ${hash.slice(0, 10)}… from tx ${existing.txHash}`);
          return;
        }
        await prisma.relayOrder.updateMany({
          where: { hash, status: 'PROCESSING' },
          data: {
            status: 'RETRY_PENDING',
            lastError: 'Fulfilled on-chain but TicketsRouted event not found — needs ops review',
            attemptCount: { increment: 1 },
            nextRetryAt: new Date(Date.now() + config.relay.maxBackoffMs),
          },
        });
        console.error(`[RELAY] CRITICAL: Order ${hash} fulfilled on-chain but receipt unrecoverable. Reconciler will resurface it.`);
        return; // don't burn BullMQ attempts on an order that must not be re-broadcast blindly
      }

      if (cls.kind === 'paused') {
        console.log(`[RELAY] Base vault paused — deferring order ${hash}.`);
        await prisma.relayOrder.updateMany({
          where: { hash, status: 'PROCESSING' },
          data: { status: 'DEFERRED', lastError: cls.reason },
        });
        return; // reconciler re-queues DEFERRED orders once unpaused
      }

      const isPermanent = cls.kind === 'permanent';
      const backoff = Math.min(
        config.relay.baseBackoffMs * 2 ** attemptNum,
        config.relay.maxBackoffMs
      );

      console.error(`[WORKER:relay-to-base] Submit failed for ${hash} (${cls.kind}):`, cls.reason ?? err?.message ?? err);
      // Full raw error too — classifyError's "reason" is a best-effort summary;
      // the underlying provider error object sometimes has more (e.g. nested
      // info.error.message) that's worth having in the logs if this recurs.
      console.error(`[WORKER:relay-to-base] Raw error for ${hash}:`, JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})).slice(0, 4000));

      await prisma.$transaction([
        prisma.relayOrder.update({
          where: { hash },
          data: {
            // Chunks already confirmed before this failure stay confirmed
            // (their tickets already have megapotNftId set) — only the
            // remaining, still-unconfirmed tickets get retried next pass.
            status: isPermanent ? 'FAILED_PERMANENT' : 'RETRY_PENDING',
            lastError: (cls.reason ?? String(err?.message ?? err)).slice(0, 2000),
            nextRetryAt: isPermanent ? null : new Date(Date.now() + backoff),
            attemptCount: { increment: 1 },
          },
        }),
        prisma.relayAttempt.create({
          data: { orderHash: hash, attemptNum, error: (cls.reason ?? String(err?.message ?? err)).slice(0, 2000) },
        }),
      ]);

      if (!isPermanent) {
        throw err; // BullMQ owns the retry schedule
      }
      console.log(`[WORKER:relay-to-base] Permanent failure recorded for ${hash}. No queue retry.`);
    }
  },
  {
    connection: redisConnection,
    // One order at a time per worker slot now waits on real chain confirmations
    // (multi-chunk orders), not just a ~100ms broadcast — lower concurrency than
    // before so a handful of large orders can't starve the nonce lane for everyone.
    concurrency: 3,
  }
);
