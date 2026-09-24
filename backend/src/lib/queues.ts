import { Queue } from 'bullmq';
import { redisConnection } from './redis';

export const webhookIngestQueue = new Queue('webhook-ingest', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const ticketIngestQueue = new Queue('ticket-ingestion', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 5000 },
    removeOnFail: false, // keep failed — orders are money
  },
});

export const baseRelayQueue = new Queue('relay-to-base', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 50,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 2000 },
    removeOnFail: false,
  },
});