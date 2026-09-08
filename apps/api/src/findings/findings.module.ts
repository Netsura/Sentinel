import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { FindingsController } from './findings.controller';
import { FindingsService } from './findings.service';

@Module({ imports: [WorkspacesModule], controllers: [FindingsController], providers: [FindingsService] })
export class FindingsModule {}
