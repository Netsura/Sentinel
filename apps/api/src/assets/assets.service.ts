import { Injectable, NotFoundException } from '@nestjs/common';
import { AssetType, VerificationStatus, WorkspaceRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { AuthUser } from '../auth/auth.service';
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
    return this.prisma.asset.create({ data: { workspaceId, type: dto.type, value, verificationToken: randomBytes(24).toString('hex') } });
  }

  async verify(user: AuthUser, workspaceId: string, assetId: string) {
    await this.workspaces.requireMembership(user, workspaceId, WorkspaceRole.ANALYST);
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, workspaceId } });
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.type === AssetType.IP) return this.setStatus(asset.id, VerificationStatus.VERIFIED);

    const records = await dns.resolveTxt(`_sentinel.${asset.value}`).catch(() => [] as string[][]);
    const expected = `sentinel-verification=${asset.verificationToken}`;
    const verified = records.flat().some((record) => record.trim() === expected);
    return this.setStatus(asset.id, verified ? VerificationStatus.VERIFIED : VerificationStatus.FAILED);
  }

  private async setStatus(id: string, verificationStatus: VerificationStatus) {
    return this.prisma.asset.update({ where: { id }, data: { verificationStatus }, select: { id: true, verificationStatus: true, value: true } });
  }

}
