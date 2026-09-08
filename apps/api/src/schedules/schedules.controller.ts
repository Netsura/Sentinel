import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateScheduleDto } from './schedules.dto';
import { SchedulesService } from './schedules.service';

@Controller('schedules')
@UseGuards(JwtAuthGuard)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId?: string) { return this.schedules.list(user, this.requireWorkspace(workspaceId)); }

  @Post()
  create(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Body() dto: CreateScheduleDto) { return this.schedules.create(user, this.requireWorkspace(workspaceId), dto); }

  @Patch(':id/pause')
  pause(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') scheduleId: string) { return this.schedules.pause(user, this.requireWorkspace(workspaceId), scheduleId); }

  @Patch(':id/resume')
  resume(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') scheduleId: string) { return this.schedules.resume(user, this.requireWorkspace(workspaceId), scheduleId); }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') scheduleId: string) { return this.schedules.remove(user, this.requireWorkspace(workspaceId), scheduleId); }

  private requireWorkspace(workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException('x-workspace-id header is required');
    return workspaceId;
  }
}
