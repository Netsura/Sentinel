import type { ConnectionOptions } from 'bullmq';

export function bullmqRedisOptions(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): ConnectionOptions {
  return {
    url,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
