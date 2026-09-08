import { Injectable } from '@nestjs/common';

@Injectable()
export class MetricsService {
  private requests = 0;
  private failures = 0;
  private totalDurationMs = 0;

  record(durationMs: number, failed: boolean) {
    this.requests += 1;
    this.totalDurationMs += durationMs;
    if (failed) this.failures += 1;
  }

  snapshot() {
    return { requests: this.requests, failures: this.failures, totalDurationMs: this.totalDurationMs, averageDurationMs: this.requests ? Math.round(this.totalDurationMs / this.requests) : 0 };
  }
}