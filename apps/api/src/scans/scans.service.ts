import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { AssetType, ScanMode, ScanStatus, VerificationStatus, WorkspaceRole } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuthUser } from '../auth/auth.service';
import { withAudit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateScanDto } from './scans.dto';

@Injectable()
export class ScansService implements OnModuleDestroy {
  private readonly queue = new Queue('scan', { connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } as never });

  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async onModuleDestroy() {
    await this.queue.close();
  }

  async list(user: AuthUser, workspaceId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    return this.prisma.scan.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async get(user: AuthUser, workspaceId: string, scanId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    const scan = await this.prisma.scan.findFirst({ where: { id: scanId, workspaceId }, include: { asset: true, findings: true } });
    if (!scan) throw new NotFoundException('Scan not found');
    return scan;
  }

  async start(user: AuthUser, workspaceId: string, dto: CreateScanDto) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const asset = await this.prisma.asset.findFirst({ where: { id: dto.assetId, workspaceId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (dto.mode !== ScanMode.SAFE && asset.verificationStatus !== VerificationStatus.VERIFIED) throw new BadRequestException('Active scans require a verified asset');
    if (asset.type === AssetType.IP && dto.mode === ScanMode.AGGRESSIVE) throw new BadRequestException('Aggressive IP scanning requires an explicit authorization workflow');

    const scan = await withAudit(this.prisma, { workspaceId, userId: user.id, action: 'SCAN_STARTED', resource: 'Scan', metadata: { assetId: asset.id, mode: dto.mode } }, (tx) =>
      tx.scan.create({ data: { workspaceId, assetId: asset.id, startedById: user.id, mode: dto.mode } }),
    );
    try {
      await this.queue.add('scan', { scanId: scan.id, workspaceId, assetId: asset.id, mode: dto.mode }, { jobId: scan.id, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 500 });
    } catch {
      await this.prisma.scan.update({ where: { id: scan.id }, data: { status: ScanStatus.FAILED } });
      throw new ServiceUnavailableException('Scan queue is unavailable');
    }
    return { scanId: scan.id, status: scan.status };
  }

  async cancel(user: AuthUser, workspaceId: string, scanId: string) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const scan = await this.prisma.scan.findFirst({ where: { id: scanId, workspaceId } });
    if (!scan) throw new NotFoundException('Scan not found');
    if (scan.status === ScanStatus.COMPLETED || scan.status === ScanStatus.FAILED || scan.status === ScanStatus.CANCELLED) return scan;
    const job = await this.queue.getJob(scan.id);
    await job?.remove();
    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'SCAN_CANCELLED', resource: 'Scan', resourceId: scan.id }, (tx) =>
      tx.scan.update({ where: { id: scan.id }, data: { status: ScanStatus.CANCELLED, stage: 'CANCELLED', completedAt: new Date() } }),
    );
  }

  async diff(user: AuthUser, workspaceId: string, previousScanId: string, currentScanId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    const scans = await this.prisma.scan.findMany({ where: { workspaceId, id: { in: [previousScanId, currentScanId] } }, include: { findings: true } });
    if (scans.length !== 2) throw new NotFoundException('Both scans must belong to the workspace');
    const previous = scans.find((scan) => scan.id === previousScanId)!;
    const current = scans.find((scan) => scan.id === currentScanId)!;
    const previousMap = new Map(previous.findings.map((finding) => [this.findingKey(finding), finding]));
    const currentMap = new Map(current.findings.map((finding) => [this.findingKey(finding), finding]));
    const newFindings = current.findings.filter((finding) => !previousMap.has(this.findingKey(finding)));
    const resolvedFindings = previous.findings.filter((finding) => !currentMap.has(this.findingKey(finding)));
    const persistentFindings = current.findings.filter((finding) => previousMap.has(this.findingKey(finding)));
    const changedFindings = persistentFindings.filter((finding) => {
      const old = previousMap.get(this.findingKey(finding))!;
      return old.severity !== finding.severity || old.evidence !== finding.evidence || old.recommendation !== finding.recommendation;
    });
    return { previousScanId, currentScanId, previousScore: previous.score, currentScore: current.score, newFindings, resolvedFindings, changedFindings, persistentFindings };
  }

  private findingKey(finding: { title: string; category: string; assetId: string }) {
    return `${finding.assetId}:${finding.category}:${finding.title}`;
  }
}
