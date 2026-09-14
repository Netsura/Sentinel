import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { AssetType, ScheduleFrequency, ScanMode, VerificationStatus, WorkspaceRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuthUser } from '../auth/auth.service';
import { withAudit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateScheduleDto } from './schedules.dto';

@Injectable()
export class SchedulesService implements OnModuleDestroy {
  private readonly queue = new Queue('scan', { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } as never });

  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async onModuleDestroy() {
    await this.queue.close();
  }

  async list(user: AuthUser, workspaceId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    return this.prisma.scheduledScan.findMany({ where: { workspaceId }, include: { asset: { select: { id: true, value: true, type: true } } }, orderBy: { nextRunAt: 'asc' } });
  }

  async create(user: AuthUser, workspaceId: string, dto: CreateScheduleDto) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const asset = await this.prisma.asset.findFirst({ where: { id: dto.assetId, workspaceId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (dto.mode !== ScanMode.SAFE && asset.verificationStatus !== VerificationStatus.VERIFIED) throw new BadRequestException('Active scheduled scans require a verified asset');
    if (asset.type === AssetType.IP && dto.mode === ScanMode.AGGRESSIVE) throw new BadRequestException('Aggressive IP schedules require explicit authorization');
    const nextRunAt = this.nextRun(dto.frequency);
    const schedule = await withAudit(this.prisma, { workspaceId, userId: user.id, action: 'SCHEDULE_CREATED', resource: 'ScheduledScan', metadata: { assetId: asset.id, mode: dto.mode, frequency: dto.frequency } }, (tx) =>
      tx.scheduledScan.create({ data: { workspaceId, assetId: asset.id, createdById: user.id, mode: dto.mode, frequency: dto.frequency, nextRunAt } }),
    );
    await this.queue.add('scheduled-scan', { scheduleId: schedule.id, workspaceId, assetId: asset.id, mode: dto.mode }, { jobId: `schedule:${schedule.id}`, repeat: { every: this.interval(dto.frequency) }, removeOnComplete: 100, removeOnFail: 500 });
    return schedule;
  }

  async pause(user: AuthUser, workspaceId: string, scheduleId: string) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const schedule = await this.find(user, workspaceId, scheduleId);
    await this.queue.removeRepeatable('scheduled-scan', { every: this.interval(schedule.frequency), jobId: `schedule:${schedule.id}` });
    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'SCHEDULE_PAUSED', resource: 'ScheduledScan', resourceId: schedule.id }, (tx) =>
      tx.scheduledScan.update({ where: { id: schedule.id }, data: { enabled: false } }),
    );
  }

  async resume(user: AuthUser, workspaceId: string, scheduleId: string) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const schedule = await this.find(user, workspaceId, scheduleId);
    await this.queue.add('scheduled-scan', { scheduleId: schedule.id, workspaceId, assetId: schedule.assetId, mode: schedule.mode }, { jobId: `schedule:${schedule.id}`, repeat: { every: this.interval(schedule.frequency) }, removeOnComplete: 100, removeOnFail: 500 });
    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'SCHEDULE_RESUMED', resource: 'ScheduledScan', resourceId: schedule.id }, (tx) =>
      tx.scheduledScan.update({ where: { id: schedule.id }, data: { enabled: true, nextRunAt: this.nextRun(schedule.frequency) } }),
    );
  }

  async remove(user: AuthUser, workspaceId: string, scheduleId: string) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const schedule = await this.find(user, workspaceId, scheduleId);
    await this.queue.removeRepeatable('scheduled-scan', { every: this.interval(schedule.frequency), jobId: `schedule:${schedule.id}` });
    await withAudit(this.prisma, { workspaceId, userId: user.id, action: 'SCHEDULE_DELETED', resource: 'ScheduledScan', resourceId: schedule.id }, (tx) =>
      tx.scheduledScan.delete({ where: { id: schedule.id } }),
    );
    return { success: true };
  }

  private async find(_user: AuthUser, workspaceId: string, scheduleId: string) {
    const schedule = await this.prisma.scheduledScan.findFirst({ where: { id: scheduleId, workspaceId } });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  private interval(frequency: ScheduleFrequency) {
    return frequency === ScheduleFrequency.DAILY ? 86_400_000 : frequency === ScheduleFrequency.WEEKLY ? 604_800_000 : 2_592_000_000;
  }

  private nextRun(frequency: ScheduleFrequency) {
    return new Date(Date.now() + this.interval(frequency));
  }
}
