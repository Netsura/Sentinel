import { Injectable, NotFoundException } from '@nestjs/common';
import { AssetType, VerificationStatus, WorkspaceRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { AuthUser } from '../auth/auth.service';
import { withAudit } from '../common/audit';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateAssetDto } from './assets.dto';
import { normalizeAssetTarget } from './asset-target';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async list(user: AuthUser, workspaceId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    return this.prisma.asset.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
  }

  async create(user: AuthUser, workspaceId: string, dto: CreateAssetDto) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const value = normalizeAssetTarget(dto.type, dto.value);
    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'ASSET_CREATED', resource: 'Asset', metadata: { type: dto.type, value } }, (tx) =>
      tx.asset.create({ data: { workspaceId, type: dto.type, value, verificationToken: randomBytes(24).toString('hex') } }),
    );
  }

  async verify(user: AuthUser, workspaceId: string, assetId: string) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, workspaceId } });
    if (!asset) throw new NotFoundException('Asset not found');
    const nextStatus = asset.type === AssetType.IP
      ? VerificationStatus.VERIFIED
      : await this.lookupDnsStatus(asset.value, asset.verificationToken);

    return withAudit(this.prisma, { workspaceId, userId: user.id, action: 'ASSET_VERIFIED', resource: 'Asset', resourceId: asset.id, metadata: { from: asset.verificationStatus, to: nextStatus } }, (tx) =>
      tx.asset.update({ where: { id: asset.id }, data: { verificationStatus: nextStatus }, select: { id: true, verificationStatus: true, value: true } }),
    );
  }

  private async lookupDnsStatus(value: string, verificationToken: string | null) {
    const records = await dns.resolveTxt(`_sentinel.${value}`).catch(() => [] as string[][]);
    const expected = `sentinel-verification=${verificationToken}`;
    return records.flat().some((record) => record.trim() === expected) ? VerificationStatus.VERIFIED : VerificationStatus.FAILED;
  }

}
