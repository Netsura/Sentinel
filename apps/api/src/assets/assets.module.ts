import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({ imports: [WorkspacesModule], controllers: [AssetsController], providers: [AssetsService] })
export class AssetsModule {}
