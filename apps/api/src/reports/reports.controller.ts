import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateReportDto } from './reports.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId?: string) {
    return this.reports.list(user, this.requireWorkspace(workspaceId));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Body() dto: CreateReportDto) {
    return this.reports.create(user, this.requireWorkspace(workspaceId), dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') reportId: string) {
    return this.reports.get(user, this.requireWorkspace(workspaceId), reportId);
  }

  private requireWorkspace(workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException('x-workspace-id header is required');
    return workspaceId;
  }
}
