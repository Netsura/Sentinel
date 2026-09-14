import { PrismaClient, ScanStatus, ScheduleFrequency } from '@prisma/client';
import type { Job } from 'bullmq';
import { ScanJobData } from './scan-runner';

export const SCHEDULE_INTERVALS: Record<ScheduleFrequency, number> = {
  DAILY: 86_400_000,
  WEEKLY: 604_800_000,
  MONTHLY: 2_592_000_000,
};

export type ScheduledJobData = { scheduleId: string; workspaceId: string; assetId: string; mode: ScanJobData['mode']; scanId?: string };

/**
 * Repeat jobs carry a schedule id. Materialize at most one Scan per job
 * attempt: reuse scanId on the job payload, otherwise reuse an in-flight scan
 * already linked to this schedule.
 */
export async function resolveScanJob(prisma: PrismaClient, job: Job<ScanJobData | ScheduledJobData>): Promise<ScanJobData | null> {
  if (job.name !== 'scheduled-scan') return job.data as ScanJobData;

  const data = job.data as ScheduledJobData;
  if (data.scanId) {
    const existing = await prisma.scan.findUnique({ where: { id: data.scanId } });
    if (existing) return { scanId: existing.id, workspaceId: existing.workspaceId, assetId: existing.assetId, mode: existing.mode };
  }

  return prisma.$transaction(async (tx) => {
    const schedule = await tx.scheduledScan.findUnique({ where: { id: data.scheduleId } });
    if (!schedule || !schedule.enabled) return null;

    const inflight = await tx.scan.findFirst({
      where: { scheduleId: schedule.id, status: { in: [ScanStatus.QUEUED, ScanStatus.RUNNING] } },
      orderBy: { createdAt: 'desc' },
    });
    if (inflight) {
      const payload = { scanId: inflight.id, workspaceId: inflight.workspaceId, assetId: inflight.assetId, mode: inflight.mode };
      await job.updateData({ ...data, ...payload }).catch(() => undefined);
      return payload;
    }

    const scan = await tx.scan.create({
      data: { workspaceId: schedule.workspaceId, assetId: schedule.assetId, startedById: schedule.createdById, scheduleId: schedule.id, mode: schedule.mode },
    });
    await tx.scheduledScan.update({
      where: { id: schedule.id },
      data: { nextRunAt: new Date(Date.now() + SCHEDULE_INTERVALS[schedule.frequency]) },
    });
    const payload: ScanJobData = { scanId: scan.id, workspaceId: schedule.workspaceId, assetId: schedule.assetId, mode: schedule.mode };
    await job.updateData({ ...data, ...payload }).catch(() => undefined);
    return payload;
  });
}
