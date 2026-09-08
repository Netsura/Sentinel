import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({ imports: [WorkspacesModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
