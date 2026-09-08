import { BadRequestException, Controller, Get, Headers, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId?: string) {
    return this.notifications.list(user, this.requireWorkspace(workspaceId));
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') notificationId: string) {
    return this.notifications.markRead(user, this.requireWorkspace(workspaceId), notificationId);
  }

  private requireWorkspace(workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException('x-workspace-id header is required');
    return workspaceId;
  }
}
