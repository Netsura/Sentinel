import Redis from 'ioredis';

/**
 * BullMQ's worker uses blocking Redis commands (BZPOPMIN / BRPOPLPUSH).
 * ioredis must be constructed with maxRetriesPerRequest: null or those
 * blocking calls throw after the first job and the worker silently stops
 * fetching WAITING jobs while the process stays alive on the health port.
 */
export function createBullmqConnection(url: string, name: string) {
  const redis = new Redis(url, {
    connectionName: `sentinel-${name}`,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10_000,
  });

  redis.on('ready', () => console.log(`[REDIS] ${name} ready`));
  redis.on('error', (error) => console.error(`[REDIS] ${name} error ${error.message}`));
  redis.on('close', () => console.warn(`[REDIS] ${name} closed`));
  redis.on('reconnecting', () => console.warn(`[REDIS] ${name} reconnecting`));

  return redis;
}
