import { Worker, Job } from 'bullmq';
import { Connection } from '@solana/web3.js';
import { redisConnection } from '../lib/redis';
import { prisma } from '../lib/db';
import { config } from '../lib/config';
import { ticketIngestQueue } from '../lib/queues';

const connection = new Connection(config.solana.rpcUrl, 'confirmed');

export const webhookIngestWorker = new Worker(
    'webhook-ingest',
    async (job: Job<{ signature: string }>) => {
        const { signature } = job.data;
        console.log(`\n[WORKER:webhook-ingest] Started processing job ${job.id} for signature: ${signature}`);

        try {
            console.log(`[DATABASE] Fetching webhook record for signature: ${signature}`);
            const inbox = await prisma.webhookInbox.findUnique({
                where: { signature },
            });

            if (!inbox) {
                console.warn(`[WORKER:webhook-ingest] Job ${job.id} aborted: No database record found for signature ${signature}`);
                return;
            }

            if (inbox.status === 'PROCESSED') {
                console.log(`[WORKER:webhook-ingest] Job ${job.id} skipped: Signature ${signature} is already marked as PROCESSED`);
                return;
            }

            // ---- CHAIN IS THE SOURCE OF TRUTH ----
            // The webhook payload is only a doorbell telling us which signature to
            // inspect. Logs that end up moving USDC on Base are ALWAYS re-fetched from
            // our own RPC, so a forged/replayed webhook can never mint a RelayOrder.
            console.log(`[WORKER:webhook-ingest] Verifying ${signature} against chain...`);
            let logs: string[] = [];

            const chainTx = await connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });

            if (chainTx) {
                if (chainTx.meta?.err) {
                    console.log(`[WORKER:webhook-ingest] Tx ${signature} FAILED on-chain. Marking SKIPPED.`);
                    await prisma.webhookInbox.update({
                        where: { signature },
                        data: { status: 'SKIPPED', error: 'Transaction failed on-chain', processedAt: new Date() },
                    });
                    return;
                }
                logs = chainTx.meta?.logMessages ?? [];
            } else if (config.nodeEnv !== 'production') {
                // Dev-only fallback: local fixtures may reference devnet txs past RPC
                // retention. NEVER allowed in production — chain or nothing.
                console.warn(`[WORKER:webhook-ingest] Tx ${signature} not found on-chain — DEV fallback to payload logs.`);
                const raw = inbox.rawPayload as any;
                logs = raw?.meta?.logMessages ?? raw?.transaction?.meta?.logMessages ?? [];
            } else {
                // RPC may simply lag behind the webhook — throw so BullMQ retries with backoff.
                throw new Error(`Tx ${signature} not visible on-chain yet — will retry`);
            }

            // NOTE: "TicketPurchaseEvent" is NOT plain text in Helius logs — it's base64 inside
            // "Program data: ...". ticketWorker.ts decodes it with eventParser.parseLogs().
            // Here we only check for the BuyTicket instruction line that IS in raw logs.
            if (!logs.some((l) => l.includes('Instruction: BuyTicket'))) {
                console.log(`[WORKER:webhook-ingest] No 'BuyTicket' instruction found. Updating status to SKIPPED.`);

                await prisma.webhookInbox.update({
                    where: { signature },
                    data: { status: 'SKIPPED', processedAt: new Date() },
                });

                console.log(`[DATABASE] Successfully marked signature ${signature} as SKIPPED`);
                return;
            }

            console.log(`[WORKER:webhook-ingest] 'BuyTicket' instruction verified. Preparing downstream task.`);

            const ticketJobId = `ticket-${signature}`;
            console.log(`[QUEUE:ticket-ingest] Dispatching parsed logs to ticketIngestQueue with Job ID: ${ticketJobId}`);
            await ticketIngestQueue.add(
                'process-solana-logs',
                { signature, logs },
                { jobId: ticketJobId }
            );
            console.log(`[QUEUE:ticket-ingest] Job successfully accepted by downstream worker`);

            console.log(`[DATABASE] Updating original webhook record status to PROCESSED`);
            await prisma.webhookInbox.update({
                where: { signature },
                data: { status: 'PROCESSED', processedAt: new Date() },
            });

            console.log(`[WORKER:webhook-ingest] Job ${job.id} completed successfully for signature: ${signature}`);

        } catch (error) {
            console.error(`[WORKER:webhook-ingest] Fatal Error during job ${job.id} processing:`, error);
            throw error; // Rethrow to let BullMQ handle the failure/retry lifecycle
        }
    },
    { connection: redisConnection, concurrency: 10 }
);