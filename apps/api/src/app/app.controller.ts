import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AppService } from './app.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, private readonly prisma: PrismaService, private readonly metrics: MetricsService) {}

  @Get()
  getData() {
    return this.appService.getData();
  }

  @SkipThrottle()
  @Get('health')
  health() {
    return { status: 'ok', service: 'sentinel-api' };
  }

  @SkipThrottle()
  @Get('ready')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') throw new Error('unexpected redis ping');
    } catch {
      throw new ServiceUnavailableException({ status: 'not-ready', service: 'sentinel-api', database: 'ok', redis: 'unavailable' });
    } finally {
      redis.disconnect();
    }
    return { status: 'ready', service: 'sentinel-api', database: 'ok', redis: 'ok' };
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
