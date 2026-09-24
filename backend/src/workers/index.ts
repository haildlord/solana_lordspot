import { webhookIngestWorker } from './webhookIngestWorker';
import ticketWorker from './ticketWorker';
import { baseRelayWorker } from './baseRelayWorker';
import { startBaseConfirmer } from './baseConfirmer';
import { startSettlementWorker } from './settlementWorker';
import { startHarvestWorker } from './harvestWorker';
import { startPayoutConfirmer } from './payoutConfirmer';
import { onShutdown } from '../lib/shutdown';

startBaseConfirmer();     // watches every ticket-buy transaction sent to Base and figures out what actually happened to it (confirmed, failed, stuck) — the "did our money actually move" checker.
startSettlementWorker();  // once a drawing's results are in, checks every ticket against the winning numbers and marks each one won or lost, with the exact amount.
startHarvestWorker();     // for tickets that won, pulls the actual USDC out of Megapot's contract and into our own vault on Base.
startPayoutConfirmer();   // once a user claims their winnings on Solana, watches that transaction to confirm the payout actually landed.

// Drain in-flight jobs on SIGINT/SIGTERM instead of dying mid-broadcast.
onShutdown('bullmq-workers', async () => {
  await Promise.allSettled([
    webhookIngestWorker.close(),
    ticketWorker.close(),
    baseRelayWorker.close(),
  ]);
});

console.log('[worker] BullMQ consumers online');
