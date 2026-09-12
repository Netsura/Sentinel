import { NotificationType, PrismaClient, ScanStatus, ScheduleFrequency } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { ScanCancelledError, ScanJobData, ScanRunner } from './scan-runner';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const prisma = new PrismaClient();
const publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
const runner = new ScanRunner(prisma, publisher);

const SCHEDULE_INTERVALS: Record<ScheduleFrequency, number> = {
  DAILY: 86_400_000,
  WEEKLY: 604_800_000,
  MONTHLY: 2_592_000_000,
};

type ScheduledJobData = { scheduleId: string; workspaceId: string; assetId: string; mode: ScanJobData['mode'] };

/**
 * Repeat jobs carry a schedule id rather than a scan id, because the Scan row
 * only exists once the occurrence actually fires. Materialize it here so both
 * job shapes converge on the same runner.
 */
async function resolveScanJob(job: Job<ScanJobData | ScheduledJobData>): Promise<ScanJobData | null> {
  if (job.name !== 'scheduled-scan') return job.data as ScanJobData;

  const { scheduleId } = job.data as ScheduledJobData;
  const schedule = await prisma.scheduledScan.findUnique({ where: { id: scheduleId } });
  if (!schedule || !schedule.enabled) return null;

  const scan = await prisma.scan.create({
    data: { workspaceId: schedule.workspaceId, assetId: schedule.assetId, startedById: schedule.createdById, mode: schedule.mode },
  });

  await prisma.scheduledScan.update({
    where: { id: schedule.id },
    data: { nextRunAt: new Date(Date.now() + SCHEDULE_INTERVALS[schedule.frequency]) },
  });

  const data: ScanJobData = { scanId: scan.id, workspaceId: schedule.workspaceId, assetId: schedule.assetId, mode: schedule.mode };
  // Persist the id so the failure handler can mark this scan FAILED.
  await job.updateData(data).catch(() => undefined);
  return data;
}

const worker = new Worker<ScanJobData | ScheduledJobData>(
  'scan',
  async (job) => {
    const started = Date.now();
    const data = await resolveScanJob(job);
    if (!data) {
      console.log(JSON.stringify({ level: 'info', message: 'scan.skipped', reason: 'schedule missing or paused', job: job.id }));
      return { skipped: true };
    }

    const result = await runner.run(data);
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'scan.completed',
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

  // Without this the scan would stay RUNNING forever once retries are spent.
  const scan = await prisma.scan
    .update({
      where: { id: scanId },
      data: { status: ScanStatus.FAILED, stage: 'FAILED', completedAt: new Date() },
      include: { asset: { select: { value: true } } },
    })
    .catch(() => null);

  if (!scan) return;

  await prisma.notification
    .create({
      data: {
        workspaceId: scan.workspaceId,
        userId: scan.startedById,
        type: NotificationType.SCAN_FAILED,
        title: 'Scan failed',
        message: `The ${scan.mode.toLowerCase()} scan of ${scan.asset.value} could not be completed: ${error?.message ?? 'unknown error'}`,
      },
    })
    .catch(() => undefined);

  await publisher.publish('scan.progress', JSON.stringify({ scanId, stage: 'FAILED', progress: 100 })).catch(() => undefined);
});

worker.on('ready', () => console.log(JSON.stringify({ level: 'info', message: 'scanner.ready', concurrency: worker.concurrency })));

async function shutdown() {
  await worker.close().catch(() => undefined);
  await publisher.quit().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
