import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ReportFormat, ScanStatus, WorkspaceRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateReportDto } from './reports.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async list(user: AuthUser, workspaceId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    return this.prisma.report.findMany({ where: { workspaceId }, select: { id: true, scanId: true, format: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async create(user: AuthUser, workspaceId: string, dto: CreateReportDto) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const scan = await this.prisma.scan.findFirst({ where: { id: dto.scanId, workspaceId }, include: { asset: true, findings: { orderBy: { severity: 'asc' } } } });
    if (!scan) throw new NotFoundException('Scan not found');
    if (scan.status !== ScanStatus.COMPLETED) throw new BadRequestException('Reports require a completed scan');

    const content = dto.format === ReportFormat.CSV ? this.toCsv(scan) : {
      executiveSummary: `${scan.findings.length} findings detected for ${scan.asset.value}.`,
      securityScore: scan.score,
      asset: { id: scan.asset.id, value: scan.asset.value, type: scan.asset.type },
      scan: { id: scan.id, mode: scan.mode, completedAt: scan.completedAt },
      findings: scan.findings,
    };
    const report = await this.prisma.report.create({ data: { workspaceId, scanId: scan.id, createdById: user.id, format: dto.format, content } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId: user.id, action: 'REPORT_GENERATED', resource: 'Report', resourceId: report.id, metadata: { scanId: scan.id, format: dto.format } } });
    return report;
  }

  async get(user: AuthUser, workspaceId: string, reportId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    const report = await this.prisma.report.findFirst({ where: { id: reportId, workspaceId } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  private toCsv(scan: { findings: Array<{ title: string; severity: string; confidence: string; category: string; evidence: string; recommendation: string }> }) {
    const headers = ['title', 'severity', 'confidence', 'category', 'evidence', 'recommendation'];
    const rows = scan.findings.map((finding) => headers.map((header) => this.escapeCsv(finding[header as keyof typeof finding])).join(','));
    return [headers.join(','), ...rows].join('\n');
  }

  private escapeCsv(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }
}
