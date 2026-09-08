import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ScansController } from './scans.controller';
import { ScansService } from './scans.service';

@Module({ imports: [WorkspacesModule], controllers: [ScansController], providers: [ScansService] })
export class ScansModule {}
