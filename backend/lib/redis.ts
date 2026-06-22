import IoRedis from "ioredis";
import { Queue } from "bullmq";

// 1. Setup Redis Connection for the Queue
export const redisConnection = new IoRedis({
    port: 6379,
    host: "127.0.0.1",
    maxRetriesPerRequest: null
});

export const ticketQueue = new Queue("ticket-ingestion", { connection: redisConnection });
export const baseRelayQueue = new Queue("relay-to-base", { connection: redisConnection});