import { createServer } from 'node:http';
import { NotificationType, PrismaClient, ScanStatus } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { resolveScanJob, ScheduledJobData } from './scan-jobs';
import { ScanCancelledError, ScanJobData, ScanRunner } from './scan-runner';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();
const publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
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
  { connection: { url: redisUrl } as never, concurrency: Number(process.env.SCANNER_CONCURRENCY ?? 2) },
);

worker.on('failed', async (job, error) => {
  if (!job) return;

  const cancelled = error instanceof ScanCancelledError || error?.name === 'ScanCancelledError';
  const attemptsExhausted = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1);
  const scanId = (job.data as ScanJobData).scanId;

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

  await publisher.publish('scan.progress', JSON.stringify({ scanId, stage: 'FAILED', progress: 100 })).catch(() => undefined);
});

worker.on('ready', () => console.log(JSON.stringify({ level: 'info', message: 'scanner.ready', concurrency: worker.concurrency })));

const port = Number(process.env.PORT);
if (Number.isFinite(port) && port > 0) {
  createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'sentinel-scanner' }));
  }).listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', message: 'scanner.health', port }));
  });
}

async function shutdown() {
  await worker.close().catch(() => undefined);
  await publisher.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
