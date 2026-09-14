import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FindingStatus, ScanStatus, Severity, VerificationStatus, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { withAudit } from '../common/audit';
import { AddMemberDto, UpdateMemberRoleDto } from './members.dto';

const TREND_WINDOW_DAYS = 30;

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.workspace.findMany({ where: { members: { some: { userId: user.id } } }, include: { members: { where: { userId: user.id }, select: { role: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async create(user: AuthUser, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: name.trim(), members: { create: { userId: user.id, role: WorkspaceRole.OWNER } } } });
      await tx.auditLog.create({ data: { workspaceId: workspace.id, userId: user.id, action: 'WORKSPACE_CREATED', resource: 'Workspace', resourceId: workspace.id } });
      return workspace;
    });
  }

  /** Single round trip for the dashboard so it does not have to stitch five list endpoints together. */
  async overview(user: AuthUser, workspaceId: string) {
    await this.requireMembership(user, workspaceId);
    const trendSince = new Date(Date.now() - TREND_WINDOW_DAYS * 86_400_000);
    const monthStart = new Date(Date.now() - 30 * 86_400_000);

    const [assets, openBySeverity, openTotal, activeScans, recentFindings, trendScans, lastCompletedScan] = await Promise.all([
      this.prisma.asset.findMany({ where: { workspaceId }, select: { securityScore: true, verificationStatus: true, createdAt: true } }),
      this.prisma.finding.groupBy({ by: ['severity'], where: { workspaceId, status: FindingStatus.OPEN }, _count: { _all: true } }),
      this.prisma.finding.count({ where: { workspaceId, status: FindingStatus.OPEN } }),
      this.prisma.scan.count({ where: { workspaceId, status: { in: [ScanStatus.QUEUED, ScanStatus.RUNNING] } } }),
      this.prisma.finding.findMany({
        where: { workspaceId, status: FindingStatus.OPEN },
        include: { asset: { select: { id: true, value: true } } },
        orderBy: [{ severity: 'asc' }, { lastDetectedAt: 'desc' }],
        take: 5,
      }),
      this.prisma.scan.findMany({
        where: { workspaceId, status: ScanStatus.COMPLETED, score: { not: null }, completedAt: { gte: trendSince } },
        select: { score: true, completedAt: true },
        orderBy: { completedAt: 'asc' },
      }),
      this.prisma.scan.findFirst({
        where: { workspaceId, status: ScanStatus.COMPLETED },
        select: { id: true, completedAt: true, score: true, asset: { select: { value: true } } },
        orderBy: { completedAt: 'desc' },
      }),
    ]);

    const scored = assets.map((asset) => asset.securityScore).filter((score): score is number => score !== null);
    const score = scored.length ? Math.round(scored.reduce((total, value) => total + value, 0) / scored.length) : null;

    const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 } as Record<Severity, number>;
    for (const group of openBySeverity) severityCounts[group.severity] = group._count._all;

    const trend = trendScans.map((scan) => ({ score: scan.score as number, at: scan.completedAt }));
    const baseline = trend.length > 1 ? trend[0].score : null;
    const latest = trend.length ? trend[trend.length - 1].score : null;

    return {
      score,
      scoreDelta: baseline !== null && latest !== null ? latest - baseline : null,
      assets: {
        total: assets.length,
        verified: assets.filter((asset) => asset.verificationStatus === VerificationStatus.VERIFIED).length,
        addedRecently: assets.filter((asset) => asset.createdAt >= monthStart).length,
      },
      findings: {
        open: openTotal,
        // Informational findings are context, not work; the dashboard headline counts only actionable ones.
        actionable: openTotal - severityCounts.INFO,
        urgent: severityCounts.CRITICAL + severityCounts.HIGH,
        bySeverity: severityCounts,
      },
      activeScans,
      recentFindings,
      trend,
      lastCompletedScan,
    };
  }

  async listMembers(user: AuthUser, workspaceId: string) {
    await this.requireMembership(user, workspaceId);
    return this.prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, email: true, emailVerified: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async addMember(user: AuthUser, workspaceId: string, dto: AddMemberDto) {
    await this.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const member = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!member) throw new NotFoundException('User must register before being added to a workspace');
    const existing = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: member.id } } });
    if (existing) throw new ConflictException('User is already a workspace member');
    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'MEMBER_ADDED', resource: 'WorkspaceMember', metadata: { memberId: member.id, role: dto.role ?? WorkspaceRole.VIEWER } }, (tx) =>
      tx.workspaceMember.create({ data: { workspaceId, userId: member.id, role: dto.role ?? WorkspaceRole.VIEWER } }),
    );
  }

  async updateMember(user: AuthUser, workspaceId: string, memberId: string, dto: UpdateMemberRoleDto) {
    await this.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const member = await this.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!member) throw new NotFoundException('Workspace member not found');
    if (member.role === WorkspaceRole.OWNER && dto.role !== WorkspaceRole.OWNER && await this.ownerCount(workspaceId) === 1) throw new ForbiddenException('A workspace must retain an owner');
    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'MEMBER_ROLE_CHANGED', resource: 'WorkspaceMember', resourceId: memberId, metadata: { from: member.role, to: dto.role } }, (tx) =>
      tx.workspaceMember.update({ where: { id: memberId }, data: { role: dto.role } }),
    );
  }

  async removeMember(user: AuthUser, workspaceId: string, memberId: string) {
    await this.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const member = await this.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!member) throw new NotFoundException('Workspace member not found');
    if (member.role === WorkspaceRole.OWNER && await this.ownerCount(workspaceId) === 1) throw new ForbiddenException('A workspace must retain an owner');
    await withAudit(this.prisma, { workspaceId, userId: user.id, action: 'MEMBER_REMOVED', resource: 'WorkspaceMember', resourceId: memberId }, (tx) =>
      tx.workspaceMember.delete({ where: { id: memberId } }),
    );
    return { success: true };
  }

  async requireMembership(user: AuthUser, workspaceId: string, minimumRole?: WorkspaceRole) {
    const membership = await this.prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
    if (!membership) throw new NotFoundException('Workspace not found');
    if (minimumRole && !this.canAccess(membership.role, minimumRole)) throw new ForbiddenException('Insufficient workspace role');
    return membership;
  }

  private canAccess(actual: WorkspaceRole, required: WorkspaceRole) {
    const rank = { VIEWER: 1, ANALYST: 2, OWNER: 3 };
    return rank[actual] >= rank[required];
  }

  private ownerCount(workspaceId: string) {
    return this.prisma.workspaceMember.count({ where: { workspaceId, role: WorkspaceRole.OWNER } });
  }
}
