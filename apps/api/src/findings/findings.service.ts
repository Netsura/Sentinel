import { Injectable, NotFoundException } from '@nestjs/common';
import { FindingStatus, WorkspaceRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { FindingQueryDto, UpdateFindingDto } from './findings.dto';

@Injectable()
export class FindingsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async list(user: AuthUser, workspaceId: string, query: FindingQueryDto) {
    await this.workspaces.requireMembership(user, workspaceId);
    return this.prisma.finding.findMany({
      where: {
        workspaceId,
        severity: query.severity,
        status: query.status,
        confidence: query.confidence,
        ...(query.search ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }, { evidence: { contains: query.search, mode: 'insensitive' } }] } : {}),
      },
      include: { asset: { select: { id: true, value: true, type: true } }, scan: { select: { id: true, mode: true, createdAt: true } } },
      orderBy: [{ severity: 'asc' }, { lastDetectedAt: 'desc' }],
      take: 200,
    });
  }

  async get(user: AuthUser, workspaceId: string, findingId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    const finding = await this.prisma.finding.findFirst({ where: { id: findingId, workspaceId }, include: { asset: true, scan: true } });
    if (!finding) throw new NotFoundException('Finding not found');
    return finding;
  }

  async update(user: AuthUser, workspaceId: string, findingId: string, dto: UpdateFindingDto) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const existing = await this.prisma.finding.findFirst({ where: { id: findingId, workspaceId } });
    if (!existing) throw new NotFoundException('Finding not found');
    const updated = await this.prisma.finding.update({ where: { id: findingId }, data: { status: dto.status, resolvedAt: dto.status === FindingStatus.RESOLVED ? new Date() : null } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId: user.id, action: 'FINDING_STATUS_CHANGED', resource: 'Finding', resourceId: findingId, metadata: { from: existing.status, to: dto.status } } });
    return updated;
  }
}
