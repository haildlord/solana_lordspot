import { Worker, Job } from "bullmq";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { id } from "ethers";
import { Prisma } from "../../generated/prisma/client";

import IDL from "../../solana_idl/solana_smart_contracts.json";
import { prisma } from "../lib/db";
import { redisConnection } from "../lib/redis";
import { baseRelayQueue } from "../lib/queues";
import { UnrecoverableError } from "bullmq";

const PROGRAM_ID = new PublicKey((IDL as any).address);
const coder = new BorshCoder(IDL as any);
const eventParser = new EventParser(PROGRAM_ID, coder);


/** Anchor may emit PascalCase (IDL) or camelCase depending on version. */
function isTicketPurchaseEvent(eventName: string): boolean {
    return eventName === "TicketPurchaseEvent" || eventName === "ticketPurchaseEvent";
}

interface TicketJob {
    signature: string;
    logs: string[];
}

const ticketWorker = new Worker(
    "ticket-ingestion",
    async (job: Job<TicketJob>) => {

        const { signature, logs } = job.data;
        console.log(`\n[WORKER:ticket-ingestion] Started processing job ${job.id} for signature: ${signature}`);

        console.log(`[WORKER:ticket-ingestion] Parsing Solana logs to extract Anchor events...`);
        const events = [...eventParser.parseLogs(logs)];

        const purchaseEvent = events.find((e) => isTicketPurchaseEvent(e.name));

        if (!purchaseEvent) {
            console.error(`[WORKER:ticket-ingestion] CRITICAL: No TicketPurchaseEvent in confirmed tx ${signature} — user paid, ticket undecodable.`);
            await prisma.webhookInbox.update({
              where: { signature },
              data: { status: 'FAILED', error: 'No TicketPurchaseEvent found in logs — needs manual review', processedAt: new Date() },
            });
            throw new UnrecoverableError(`No TicketPurchaseEvent in logs for ${signature}`);
          }

        console.log(`[WORKER:ticket-ingestion] Successfully extracted TicketPurchaseEvent. Decoding event data...`);

        // Anchor decodes event fields as snake_case (matches on-chain struct)
        const eventData = purchaseEvent.data as Record<string, any>;
        const {
            buyer,
            amount_paid,
            tickets_bought,
            tickets_data,
            timestamp,
            epoch,
        } = eventData;

        const hash = id(signature);
        console.log(`[WORKER:ticket-ingestion] Generated unique relay hash: ${hash}`);

        try {
            console.log(`[DATABASE] Executing relayOrder creation for hash: ${hash}, epoch: ${epoch.toNumber()}`);

            await prisma.relayOrder.create({
                data: {
                    hash,
                    signature,
                    buyer: buyer.toBase58(),
                    purchaseEpoch: epoch.toNumber(),
                    amountUsdc: BigInt(amount_paid.toString()),
                    ticketCount: tickets_bought,
                    lastBought: new Date(timestamp.toNumber() * 1000),
                    status: "QUEUED",
                    tickets: {
                        create: tickets_data.map((ticket: { bonus_ball: number; normal_ball: number[] }) => ({
                            bonusBall: ticket.bonus_ball,
                            normalBalls: Array.from(ticket.normal_ball),
                        })),
                    },
                },
            });

            console.log(`[DATABASE] Successfully persisted order and ${tickets_data.length} ticket(s) to database`);

            const relayJobId = `relay-${hash}`;
            console.log(`[QUEUE:base-relay] Dispatching payload to baseRelayQueue with Job ID: ${relayJobId}`);

            await baseRelayQueue.add(
                "relay-to-base",
                { hash },
                { jobId: relayJobId }
            );

            console.log(`[QUEUE:base-relay] Job successfully accepted by relay worker`);
            console.log(`[WORKER:ticket-ingestion] Job ${job.id} completed successfully for hash: ${hash}`);

        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002"
            ) {
                console.warn(`[DATABASE] Duplicate order detected (P2002 constraint). Hash ${hash} already exists.`);
                console.log(`[QUEUE:base-relay] Ensuring duplicate is still queued for relay...`);

                await baseRelayQueue.add(
                    "relay-to-base",
                    { hash },
                    { jobId: `relay-${hash}` } // BullMQ will dedup this if it's already in the queue
                );

                console.log(`[WORKER:ticket-ingestion] Duplicate handled gracefully. Job completed.`);
                return;
            }

            console.error(`[WORKER:ticket-ingestion] Fatal Error processing hash ${hash}:`, error);
            throw error;
        }
    },
    { connection: redisConnection, concurrency: 5 }
);

export default ticketWorker;