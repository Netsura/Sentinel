import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScanGateway } from './scan.gateway';

@Module({ imports: [AuthModule], providers: [ScanGateway] })
export class RealtimeModule {}
