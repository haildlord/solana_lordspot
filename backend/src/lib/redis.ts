import IoRedis from 'ioredis';
import { config } from './config';

export const redisConnection = new IoRedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
