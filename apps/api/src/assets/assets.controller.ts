import { BadRequestException, Controller, Get, Headers, Param, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.service';
import { CreateAssetDto } from './assets.dto';
import { AssetsService } from './assets.service';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId?: string) {
    return this.assets.list(user, this.requireWorkspace(workspaceId));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Body() dto: CreateAssetDto) {
    return this.assets.create(user, this.requireWorkspace(workspaceId), dto);
  }

  @Post(':id/verify')
  verify(@CurrentUser() user: AuthUser, @Headers('x-workspace-id') workspaceId: string | undefined, @Param('id') assetId: string) {
    return this.assets.verify(user, this.requireWorkspace(workspaceId), assetId);
  }

  private requireWorkspace(workspaceId?: string) {
    if (!workspaceId) throw new BadRequestException('x-workspace-id header is required');
    return workspaceId;
  }
}
