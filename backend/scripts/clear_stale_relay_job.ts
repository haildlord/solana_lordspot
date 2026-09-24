import { baseRelayQueue } from '../src/lib/queues';

/**
 * Removes a specific job from the relay-to-base queue by its BullMQ job id
 * (the "relay-0x..." string from the worker logs, e.g. "Job relay-0xfc59103d...
 * aborted: No order found for hash ..."). Uses BullMQ's own Job#remove(),
 * which cleans up every internal Redis structure (wait/active/delayed/failed
 * sets, locks) — unlike a raw `redis-cli DEL` on the hash key alone, which
 * would leave those index sets pointing at data that no longer exists.
 *
 * Run: npx tsx scripts/clear_stale_relay_job.ts relay-0xHASH   (from backend/)
 */

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: npx tsx scripts/clear_stale_relay_job.ts <jobId>');
    process.exit(1);
  }

  const job = await baseRelayQueue.getJob(jobId);
  if (!job) {
    console.log(`No job found with id "${jobId}" — nothing to clear.`);
    process.exit(0);
  }

  await job.remove();
  console.log(`Removed job "${jobId}" from relay-to-base.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
