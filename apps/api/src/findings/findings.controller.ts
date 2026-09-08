import { BadRequestException, Body, Controller, Get, Headers, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { FindingQueryDto, UpdateFindingDto } from './findings.dto';
import { FindingsService } from './findings.service';

@Controller('findings')
@UseGuards(JwtAuthGuard)
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Query() query: FindingQueryDto) {
    return this.findings.list(user, this.requireWorkspace(workspaceId), query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') findingId: string) {
    return this.findings.get(user, this.requireWorkspace(workspaceId), findingId);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') findingId: string, @Body() dto: UpdateFindingDto) {
    return this.findings.update(user, this.requireWorkspace(workspaceId), findingId, dto);
  }

  private requireWorkspace(workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException('x-workspace-id header is required');
    return workspaceId;
  }
}
