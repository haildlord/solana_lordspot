import { redisConnection, redisSubscriber } from './redis';

/**
 * Cross-process "don't wait for your poll timer" nudges via Redis pub/sub —
 * works no matter how processes are split in production (API/worker/cron in
 * one process, or several). Every consumer still has its own periodic poll
 * as the reliable backstop (crash recovery, catching anything a nudge
 * misses); these events are a pure latency shortcut, published best-effort,
 * never required for correctness.
 *
 *   megapotService saves a settled epoch -> publishes EPOCH_SETTLED
 *   settlementWorker reacts immediately -> grades it -> publishes EPOCH_GRADED
 *   harvestWorker reacts immediately -> harvests it
 */
const EPOCH_SETTLED_CHANNEL = 'epoch:settled'; // a MegapotEpoch row was just saved (result known, not graded yet)
const EPOCH_GRADED_CHANNEL = 'epoch:graded'; // settlement finished grading that epoch (ticketsSettledAt just set)

function publish(channel: string, megapotId: number): void {
  redisConnection.publish(channel, String(megapotId)).catch((err) => {
    console.error(`[pubsub] Failed to publish on ${channel}:`, err);
  });
}

function subscribe(channel: string, callback: (megapotId: number) => void): void {
  redisSubscriber.subscribe(channel).catch((err) => {
    console.error(`[pubsub] Failed to subscribe to ${channel}:`, err);
  });
  redisSubscriber.on('message', (msgChannel, message) => {
    if (msgChannel === channel) callback(Number(message));
  });
}

export const publishEpochSettled = (megapotId: number) => publish(EPOCH_SETTLED_CHANNEL, megapotId);
export const publishEpochGraded = (megapotId: number) => publish(EPOCH_GRADED_CHANNEL, megapotId);

export const onEpochSettled = (callback: (megapotId: number) => void) => subscribe(EPOCH_SETTLED_CHANNEL, callback);
export const onEpochGraded = (callback: (megapotId: number) => void) => subscribe(EPOCH_GRADED_CHANNEL, callback);
