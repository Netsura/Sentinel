import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.service';
import { AddMemberDto, UpdateMemberRoleDto } from './members.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser) {
    return this.prisma.workspace.findMany({ where: { members: { some: { userId: user.id } } }, include: { members: { where: { userId: user.id }, select: { role: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async create(user: AuthUser, name: string) {
    return this.prisma.workspace.create({ data: { name: name.trim(), members: { create: { userId: user.id, role: WorkspaceRole.OWNER } } } });
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
    const created = await this.prisma.workspaceMember.create({ data: { workspaceId, userId: member.id, role: dto.role ?? WorkspaceRole.VIEWER } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId: user.id, action: 'MEMBER_ADDED', resource: 'WorkspaceMember', resourceId: created.id, metadata: { memberId: member.id, role: created.role } } });
    return created;
  }

  async updateMember(user: AuthUser, workspaceId: string, memberId: string, dto: UpdateMemberRoleDto) {
    await this.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const member = await this.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!member) throw new NotFoundException('Workspace member not found');
    if (member.role === WorkspaceRole.OWNER && dto.role !== WorkspaceRole.OWNER && await this.ownerCount(workspaceId) === 1) throw new ForbiddenException('A workspace must retain an owner');
    return this.prisma.workspaceMember.update({ where: { id: memberId }, data: { role: dto.role } });
  }

  async removeMember(user: AuthUser, workspaceId: string, memberId: string) {
    await this.requireMembership(user, workspaceId, WorkspaceRole.OWNER);
    const member = await this.prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId } });
    if (!member) throw new NotFoundException('Workspace member not found');
    if (member.role === WorkspaceRole.OWNER && await this.ownerCount(workspaceId) === 1) throw new ForbiddenException('A workspace must retain an owner');
    await this.prisma.workspaceMember.delete({ where: { id: memberId } });
    await this.prisma.auditLog.create({ data: { workspaceId, userId: user.id, action: 'MEMBER_REMOVED', resource: 'WorkspaceMember', resourceId: memberId } });
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
