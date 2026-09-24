import { prisma } from '../lib/db';
import { baseRelayQueue } from '../lib/queues';
import { config } from '../lib/config';
import { megapotService } from '../services/megapotService';
import { OrderStatus } from '../../generated/prisma/client';

const RELAYABLE: OrderStatus[] = [
  'QUEUED',
  'RETRY_PENDING',
  'DEFERRED',
  'SOLANA_CONFIRMED',
];

export async function runReconciler(): Promise<void> {
  const stuckBefore = new Date(
    Date.now() - config.relay.processingTimeoutMs
  );

  const stuck = await prisma.relayOrder.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: stuckBefore } },
  });

  for (const order of stuck) {
    await prisma.relayOrder.update({
      where: { hash: order.hash },
      data: {
        status: 'RETRY_PENDING',
        lastError: 'Processing timeout — reset by reconciler',
      },
    });
  }

  const round = await megapotService.getRoundState();
  const canRelay =
    round !== null &&
    !megapotService.isRoundLocked(round) &&
    !(await megapotService.isProtocolPaused());

  if (canRelay) {
    await prisma.relayOrder.updateMany({
      where: { status: 'DEFERRED' },
      data: { status: 'QUEUED' },
    });
  }

  const pending = await prisma.relayOrder.findMany({
    where: {
      status: { in: [...RELAYABLE] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    take: 100,
  });

  let reEnqueued = 0;
  for (const order of pending) {
    if (order.status === 'DEFERRED' && !canRelay) continue;

    // jobId must be fresh on every pass: BullMQ retains completed jobs, so
    // re-adding the original `relay-${hash}` id would silently dedupe against
    // the finished job and the re-enqueue would never run. attemptCount can't
    // serve as that suffix — the "protocol paused, defer" path in
    // baseRelayWorker.ts never increments it, so an order that keeps getting
    // deferred (never reaching a real submit attempt) would get the exact
    // same jobId every single reconciler tick, silently deduping forever.
    // Date.now() is guaranteed to differ on every pass regardless of which
    // path the order took last.
    await baseRelayQueue.add(
      'relay-to-base',
      { hash: order.hash },
      { jobId: `relay-${order.hash}-r${Date.now()}` }
    );
    reEnqueued++;
  }

  if (stuck.length > 0 || reEnqueued > 0) {
    console.log(
      `[reconciler] reset=${stuck.length} re-enqueued=${reEnqueued}`
    );
  }
}
