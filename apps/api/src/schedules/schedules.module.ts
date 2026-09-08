import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({ imports: [WorkspacesModule], controllers: [SchedulesController], providers: [SchedulesService] })
export class SchedulesModule {}
