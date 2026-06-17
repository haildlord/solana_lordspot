import { Worker, Job } from "bullmq";
import IoRedis from "ioredis";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import IDL from "../solana_idl/solana_smart_contracts.json";

const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// 2. Build Decoder
const PROGRAM_ID = new PublicKey("6MCjqsDP4zjxxg2AWCrjDGeKYUiWL3xpG2ccUxLXaMB9");
const coder = new BorshCoder(IDL as any);
const eventParser = new EventParser(PROGRAM_ID, coder);

// 3. Redis Connection for Worker
const redisConnection = new IoRedis({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null
});

// 4. Worker Logic
const ticketWorker = new Worker(
    "ticket-ingestion",
    async (job: Job) => {
        console.log(`\n⚙️ [WORKER]: Processing Job #${job.id} pulled from Redis queue...`);
        
        const { signature, logs } = job.data;
        const events = eventParser.parseLogs(logs);

        for (let event of events) {
            if (event.name === "TicketPurchaseEvent") {
                console.log("🎟️ [EVENT MATCH]: 'TicketPurchaseEvent' caught by processing engine.");
                const eventData = event.data as any;
                
                const buyerAddress = eventData.buyer.toBase58();
                const purchaseDate = new Date(); 

                if (!eventData.tickets_data || !Array.isArray(eventData.tickets_data)) {
                    console.log("⚠️ [WORKER]: Event matched but tickets_data array was blank.");
                    continue;
                }

                const ticketsToInsert = eventData.tickets_data.map((ticket: any) => {
                    return {
                        signature: signature,
                        buyer: buyerAddress,
                        link_to_nft: null,
                        bonusBall: ticket.bonus_ball,
                        normalBalls: Array.from(ticket.normal_ball), 
                        lastBought: purchaseDate
                    };
                });


                try {
                    const inserted = await prisma.ticket.createMany({
                        data: ticketsToInsert
                    });

                    console.log(`💾 [DATABASE SUCCESS]: ${inserted.count} tickets cleanly written to PostgreSQL for transaction: ${signature.slice(0, 8)}...`);
                } catch (dbError) {
                    console.error(`❌ [DATABASE CRITICAL ERROR]: Failed writing records to Postgres database engine.`, dbError);
                    throw dbError; 
                }
            }
        }
    },
    { connection: redisConnection }
);

export default ticketWorker;