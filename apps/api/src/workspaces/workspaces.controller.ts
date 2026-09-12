import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { WorkspacesService } from './workspaces.service';
import { AddMemberDto, UpdateMemberRoleDto } from './members.dto';

class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  name!: string;
}

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) { return this.workspaces.list(user); }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) { return this.workspaces.create(user, dto.name); }

  @Get(':workspaceId/overview')
  overview(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) { return this.workspaces.overview(user, workspaceId); }

  @Get(':workspaceId/members')
  listMembers(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string) { return this.workspaces.listMembers(user, workspaceId); }

  @Post(':workspaceId/members')
  addMember(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() dto: AddMemberDto) { return this.workspaces.addMember(user, workspaceId, dto); }

  @Patch(':workspaceId/members/:memberId')
  updateMember(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('memberId') memberId: string, @Body() dto: UpdateMemberRoleDto) { return this.workspaces.updateMember(user, workspaceId, memberId, dto); }

  @Delete(':workspaceId/members/:memberId')
  removeMember(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('memberId') memberId: string) { return this.workspaces.removeMember(user, workspaceId, memberId); }
}
