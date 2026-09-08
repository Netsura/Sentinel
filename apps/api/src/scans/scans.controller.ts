import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateScanDto } from './scans.dto';
import { ScansService } from './scans.service';

@Controller('scans')
@UseGuards(JwtAuthGuard)
export class ScansController {
  constructor(private readonly scans: ScansService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId?: string) {
    return this.scans.list(user, this.requireWorkspace(workspaceId));
  }

  @Get('diff')
  diff(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Query('previous') previousScanId: string, @Query('current') currentScanId: string) {
    if (!previousScanId || !currentScanId) throw new BadRequestException('previous and current scan IDs are required');
    return this.scans.diff(user, this.requireWorkspace(workspaceId), previousScanId, currentScanId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') scanId: string) {
    return this.scans.get(user, this.requireWorkspace(workspaceId), scanId);
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Body() dto: CreateScanDto) {
    return this.scans.start(user, this.requireWorkspace(workspaceId), dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') scanId: string) {
    return this.scans.cancel(user, this.requireWorkspace(workspaceId), scanId);
  }

  private requireWorkspace(workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException('x-workspace-id header is required');
    return workspaceId;
  }
}
