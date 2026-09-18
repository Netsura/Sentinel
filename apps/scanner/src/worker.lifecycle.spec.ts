import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { createBullmqConnection } from './lib/redis';

jest.setTimeout(30_000);

describe('BullMQ worker lifecycle', () => {
  it('processes multiple jobs on the same worker without a restart', async () => {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const probe = new Redis(url, { lazyConnect: true, connectTimeout: 1_000, maxRetriesPerRequest: 1 });
    let available = false;
    try {
      await probe.connect();
      await probe.ping();
      available = true;
    } catch {
      available = false;
    } finally {
      probe.disconnect();
    }
    if (!available) {
      if (process.env.CI) throw new Error('Redis is required to verify multi-job worker processing');
      return;
    }

    const workerRedis = createBullmqConnection(url, 'test-worker');
    const queueRedis = createBullmqConnection(url, 'test-queue');
    const queueName = `scan-lifecycle-${process.pid}-${Date.now()}`;
    const processed: string[] = [];
    const queue = new Queue(queueName, { connection: queueRedis });
    const worker = new Worker(
      queueName,
      async (job) => {
        processed.push(String(job.id));
        return { ok: true, scanId: job.data.scanId };
      },
      { connection: workerRedis, concurrency: 2, lockDuration: 10_000 },
    );

    try {
      await worker.waitUntilReady();
      await queue.add('scan', { scanId: 'scan-1' }, { jobId: 'scan-1', removeOnComplete: { count: 10 } });
      await queue.add('scan', { scanId: 'scan-2' }, { jobId: 'scan-2', removeOnComplete: { count: 10 } });
      await queue.add('scan', { scanId: 'scan-3' }, { jobId: 'scan-3', removeOnComplete: { count: 10 } });

      await waitUntil(() => processed.length === 3);
      expect([...processed].sort()).toEqual(['scan-1', 'scan-2', 'scan-3']);
      expect(await queue.getJobCountByTypes('waiting', 'active', 'delayed', 'paused')).toBe(0);

      await queue.add('scan', { scanId: 'scan-4' }, { jobId: 'scan-4', removeOnComplete: { count: 10 } });
      await waitUntil(() => processed.length === 4);
      expect(processed).toContain('scan-4');
      expect(processed).toHaveLength(4);
    } finally {
      await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      workerRedis.removeAllListeners();
      queueRedis.removeAllListeners();
      await workerRedis.quit().catch(() => undefined);
      await queueRedis.quit().catch(() => undefined);
    }
  });
});

function waitUntil(predicate: () => boolean, timeoutMs = 15_000) {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for worker to drain jobs'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}
