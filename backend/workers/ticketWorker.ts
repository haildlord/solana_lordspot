import { Worker, Job } from "bullmq";
import { BorshCoder, EventParser, IdlEvents } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { id } from "ethers";

import IDL from "../solana_idl/solana_smart_contracts.json";
import { SolanaSmartContracts } from "../solana_types/solana_smart_contracts";
import { prisma } from "../lib/db";
import { Prisma } from "@prisma/client";
import { redisConnection, baseRelayQueue } from "../lib/redis";


type TicketPurchaseEventData = IdlEvents<SolanaSmartContracts>["ticketPurchaseEvent"];

// 1. Build Decoder
const PROGRAM_ID = new PublicKey((IDL as any).address);
const coder = new BorshCoder(IDL as any);
const eventParser = new EventParser(PROGRAM_ID, coder);

// 2. Worker Logic
const ticketWorker = new Worker(
    "ticket-ingestion",
    async (job: Job) => {
        console.log(`\n[WORKER]: Processing Job #${job.id} pulled from Redis queue...`);
        
        const { signature, logs } = job.data;
        const events = eventParser.parseLogs(logs);

        for (let event of events) {
    
            if (event.name === "TicketPurchaseEvent") { 

                console.log("[EVENT MATCH]: 'TicketPurchaseEvent' caught by processing engine.");
                const eventData = event.data as Record<string, any>;

                const { 
                    buyer, 
                    amount_paid: amountPaid, 
                    tickets_bought: ticketsBought, 
                    tickets_data: ticketsData, 
                    timestamp, 
                    epoch 
                } = eventData;
                
                const hash = id(signature);

                try {
                    // This creates the RelayOrder AND the Tickets in one single guaranteed transaction.
                    const order = await prisma.relayOrder.create({
                        data: {
                            hash: hash,
                            signature: signature,
                            buyer: buyer.toBase58(),
                            epoch: epoch.toNumber(),
                            lastBought: new Date(timestamp.toNumber() * 1000),
                            tickets: {
                                create: ticketsData.map((ticket : any) => ({
                                    bonusBall: ticket.bonus_ball,
                                    normalBalls: Array.from(ticket.normal_ball),
                                }))
                            }
                        }
                    });

                    console.log(`[DATABASE SUCCESS]: Order and ${ticketsData.length} tickets safely committed for: ${signature.slice(0, 8)}... Epoch: ${epoch.toNumber()}`);

                    await baseRelayQueue.add("relay-to-base", {
                        hash
                    },{
                        attempts: 10,
                        backoff: { type: 'exponential', delay: 2000 }
                    });

                    console.log(`[HANDOFF]: Order ${hash} passed to Base L2 Relayer Queue.`);

                } catch (error) {
                    // 3. Check if it's a duplicate hash error
                    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                        console.log(`[DUPLICATE BLOCKED]: Order ${hash} already exists. Skipping queue handoff.`);
                        return; // Safely exit the worker job without doing anything else
                    }
                
                    // 4. If it's a real database outage or different error, throw it so the queue retries the job later
                    console.error(`[DATABASE ERROR]: Failed to process order ${hash}`, error);
                    throw error; 
                }
            }
        }
    },
    { connection: redisConnection }
);

export default ticketWorker;