import { baseRelayQueue } from '../src/lib/queues';

/**
 * TESTING ONLY — wipes every job in the relay-to-base queue (waiting, active,
 * delayed, completed, and failed), regardless of what order/hash they belong
 * to. Uses BullMQ's Queue#obliterate(), which — unlike removing jobs one by
 * one — also clears the queue's own meta/lock keys, so it comes back clean.
 *
 * This does NOT touch Postgres — any RelayOrder rows still sitting in
 * QUEUED/RETRY_PENDING/DEFERRED etc. will just never get re-enqueued unless
 * the reconciler or a fresh ticket purchase re-adds them.
 *
 * Run: npx tsx scripts/clear_all_relay_jobs.ts   (from backend/)
 */

async function main() {
  const counts = await baseRelayQueue.getJobCounts();
  console.log('Current relay-to-base job counts:', counts);

  await baseRelayQueue.obliterate({ force: true });

  console.log('relay-to-base queue obliterated — 0 jobs remaining.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
