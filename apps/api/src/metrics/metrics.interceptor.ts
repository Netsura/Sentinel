import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    const startedAt = Date.now();
    return next.handle().pipe(tap({ next: () => this.metrics.record(Date.now() - startedAt, false), error: () => this.metrics.record(Date.now() - startedAt, true) }));
  }
}