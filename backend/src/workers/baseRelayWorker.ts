import { Worker, Job } from 'bullmq';
import { OrderStatus } from '../../generated/prisma/client';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/db';
import { config } from '../lib/config';
import { baseService } from '../services/baseService';
import { megapotService } from '../services/megapotService';
import { finalizeOrderSuccess } from './baseConfirmer';

/**
 * The SUBMITTER — fast half of the submit/confirm split.
 * Gates the order (status / pause / solvency), broadcasts the Base tx, persists
 * the tx hash IMMEDIATELY, and walks away. It never waits for mining — receipts,
 * reverts and stuck txs are the confirmer's job (baseConfirmer.ts). This is what
 * lets N orders ride the nonce lane into the same block instead of one-per-block.
 */

const RELAYABLE: OrderStatus[] = [
  'QUEUED',
  'RETRY_PENDING',
  'DEFERRED',
  'SOLANA_CONFIRMED',
];

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
    const formattedTickets = order.tickets.map((t) => ({
      normals: t.normalBalls,
      bonusball: t.bonusBall,
    }));

    try {
      
      console.log(`[SERVICE:base] Broadcasting buyTickets for ${order.tickets.length} ticket(s) (Attempt: ${attemptNum})...`);
      const { txHash, nonce } = await baseService.submitBuyTickets({
        orderId: hash,
        tickets: formattedTickets,
        source: hash,
      });

      // Persist the hash IMMEDIATELY — this is what makes a crash after
      // broadcast recoverable (the confirmer can always look the tx up).
      await prisma.$transaction([
        prisma.relayOrder.update({
          where: { hash },
          data: { status: 'BASE_SUBMITTED', baseTxHash: txHash, lastError: null },
        }),
        prisma.relayAttempt.create({
          data: { orderHash: hash, attemptNum, baseTxHash: txHash },
        }),
      ]);

      await baseService.debitVaultBalanceCache(order.amountUsdc);

      console.log(`[RELAY] Order ${hash.slice(0, 10)}… broadcast (nonce ${nonce}). Confirmer takes it from here. Tx: ${txHash}`);
      return;

    } catch (err: any) {
      const cls = baseService.classifyError(err);

      if (cls.kind === 'already_processed') {
        // estimateGas simulation reverted with OrderAlreadyProcessed: an earlier
        // broadcast (crash recovery / duplicate delivery) already fulfilled this.
        // Recover the original receipt instead of burning gas on a doomed tx.
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

      console.error(`[WORKER:relay-to-base] Submit failed for ${hash} (${cls.kind}):`, cls.reason);

      await prisma.$transaction([
        prisma.relayOrder.update({
          where: { hash },
          data: {
            status: isPermanent ? 'FAILED_PERMANENT' : 'RETRY_PENDING',
            lastError: cls.reason.slice(0, 2000),
            nextRetryAt: isPermanent ? null : new Date(Date.now() + backoff),
            attemptCount: { increment: 1 },
          },
        }),
        prisma.relayAttempt.create({
          data: { orderHash: hash, attemptNum, error: cls.reason.slice(0, 2000) },
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
    // Submits don't wait for mining — the nonce lane serializes only the
    // ~100ms broadcast itself, so higher concurrency is safe and useful.
    concurrency: 10,
  }
);
