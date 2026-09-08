import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly workspaces: WorkspacesService) {}

  async list(user: AuthUser, workspaceId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    return this.prisma.notification.findMany({ where: { workspaceId, userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async markRead(user: AuthUser, workspaceId: string, notificationId: string) {
    await this.workspaces.requireMembership(user, workspaceId);
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, workspaceId, userId: user.id } });
    if (!notification) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  }
}
