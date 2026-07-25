import { webhookIngestWorker } from './webhookIngestWorker';
import ticketWorker from './ticketWorker';
import { baseRelayWorker } from './baseRelayWorker';
import { startBaseConfirmer } from './baseConfirmer';
import { startSettlementWorker } from './settlementWorker';
import { startHarvestWorker } from './harvestWorker';
import { startPayoutConfirmer } from './payoutConfirmer';
import { onShutdown } from '../lib/shutdown';

startBaseConfirmer();
startSettlementWorker();
// Money movers — worker process ONLY (never the cron): harvest broadcasts
// Base txs, and the payout confirmer finalizes Solana claim vouchers.
startHarvestWorker();
startPayoutConfirmer();

// Drain in-flight jobs on SIGINT/SIGTERM instead of dying mid-broadcast.
onShutdown('bullmq-workers', async () => {
  await Promise.allSettled([
    webhookIngestWorker.close(),
    ticketWorker.close(),
    baseRelayWorker.close(),
  ]);
});

console.log('[worker] BullMQ consumers online');
