import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AssetsModule } from '../assets/assets.module';
import { ScansModule } from '../scans/scans.module';
import { FindingsModule } from '../findings/findings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReportsModule } from '../reports/reports.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MetricsModule } from '../metrics/metrics.module';
import { MetricsInterceptor } from '../metrics/metrics.interceptor';
import { MailModule } from '../mail/mail.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]), PrismaModule, MailModule, MetricsModule, AuthModule, WorkspacesModule, AssetsModule, ScansModule, FindingsModule, RealtimeModule, ReportsModule, SchedulesModule, NotificationsModule, BillingModule],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
