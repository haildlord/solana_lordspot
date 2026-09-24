import IoRedis from 'ioredis';
import { config } from './config';

export const redisConnection = new IoRedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// A connection in subscribe mode can't run other commands, so pub/sub needs
// its own dedicated connection — see lib/epochEvents.ts.
export const redisSubscriber = redisConnection.duplicate();
