import { createServer } from 'node:http';
import { NotificationType, PrismaClient, ScanStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { createBullmqConnection } from './lib/redis';
import { resolveScanJob, ScheduledJobData } from './scan-jobs';
import { ScanCancelledError, ScanJobData, ScanRunner } from './scan-runner';

const port = Number(process.env.PORT || 10000);
const healthServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', service: 'sentinel-scanner' }));
}).listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', message: 'scanner.health', port }));
});

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();
const workerRedis = createBullmqConnection(redisUrl, 'worker');
const publisher = createBullmqConnection(redisUrl, 'publisher');
const runner = new ScanRunner(prisma, publisher);

const worker = new Worker<ScanJobData | ScheduledJobData>(
  'scan',
  async (job: Job<ScanJobData | ScheduledJobData>) => {
    const started = Date.now();
    const data = await resolveScanJob(prisma, job);
    if (!data) {
      console.log(JSON.stringify({ level: 'info', message: 'scan.skipped', reason: 'schedule missing or paused', job: job.id }));
      return { skipped: true };
    }

    const result = await runner.run(data);
    console.log(
      JSON.stringify({
        level: 'info',
        message: result.skipped ? 'scan.already-complete' : 'scan.completed',
        scanId: data.scanId,
        mode: data.mode,
        score: result.score,
        findings: result.findings,
        requests: result.requests,
        durationMs: Date.now() - started,
      }),
    );
    return result;
  },
  {
    connection: workerRedis,
    concurrency: Number(process.env.SCANNER_CONCURRENCY ?? 2),
    lockDuration: 120_000,
    stalledInterval: 30_000,
  },
);

worker.on('ready', () => {
  console.log('[BULLMQ] Worker ready');
  console.log(JSON.stringify({ level: 'info', message: 'scanner.ready', concurrency: worker.concurrency }));
});
worker.on('active', (job) => console.log(`[SCAN] Starting job ${job.id}`));
worker.on('completed', (job) => console.log(`[SCAN] Completed job ${job.id}`));
worker.on('stalled', (jobId) => console.error(`[BULLMQ] Job stalled ${jobId}`));
worker.on('error', (error) => console.error(`[BULLMQ] Worker error ${error.message}`));

worker.on('failed', async (job, error) => {
  if (!job) return;

  const cancelled = error instanceof ScanCancelledError || error?.name === 'ScanCancelledError';
  const attemptsExhausted = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1);
  const scanId = (job.data as ScanJobData).scanId;

  console.error(`[SCAN] Failed job ${job.id}`);
  console.error(
    JSON.stringify({
      level: 'error',
      message: cancelled ? 'scan.cancelled' : 'scan.failed',
      scanId,
      attempt: job.attemptsMade,
      error: error?.message ?? 'unknown error',
    }),
  );

  if (cancelled || !attemptsExhausted || !scanId) return;

  const scan = await prisma.scan
    .updateMany({
      where: { id: scanId, status: { in: [ScanStatus.QUEUED, ScanStatus.RUNNING] } },
      data: { status: ScanStatus.FAILED, stage: 'FAILED', completedAt: new Date() },
    })
    .then(async (result) => {
      if (result.count === 0) return null;
      return prisma.scan.findUnique({ where: { id: scanId }, include: { asset: { select: { value: true } } } });
    })
    .catch(() => null);

  if (!scan) return;

  const alreadyNotified = await prisma.notification.findFirst({
    where: { workspaceId: scan.workspaceId, userId: scan.startedById, type: NotificationType.SCAN_FAILED, message: { contains: scan.id } },
  });
  if (!alreadyNotified) {
    await prisma.notification
      .create({
        data: {
          workspaceId: scan.workspaceId,
          userId: scan.startedById,
          type: NotificationType.SCAN_FAILED,
          title: 'Scan failed',
          message: `The ${scan.mode.toLowerCase()} scan of ${scan.asset.value} could not be completed: ${error?.message ?? 'unknown error'} [${scan.id}]`,
        },
      })
      .catch(() => undefined);
  }

  try {
    await publisher.publish('scan.progress', JSON.stringify({ scanId, stage: 'FAILED', progress: 100 }));
  } catch (publishError) {
    console.error(`[SCAN] Progress publish failed ${scanId} ${publishError instanceof Error ? publishError.message : publishError}`);
  }
});

async function shutdown() {
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await worker.close().catch(() => undefined);
  await workerRedis.quit().catch(() => undefined);
  await publisher.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
