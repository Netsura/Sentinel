import { ScanMode } from '@prisma/client';
import { SafeHttpOptions } from './net';

export type CrawlProfile = {
  maxPages: number;
  maxDepth: number;
  maxScripts: number;
  respectRobots: boolean;
};

export type DiscoveryProfile = {
  tier: 'common' | 'extended';
  probeMethods: boolean;
  probeDisallowedPaths: boolean;
};

export type ScanProfile = {
  http: SafeHttpOptions;
  crawl: CrawlProfile | null;
  discovery: DiscoveryProfile | null;
  probeLegacyTls: boolean;
  enumerateSubdomains: boolean;
};

/**
 * Request budgets and intervals are the contract that keeps an "aggressive"
 * scan from behaving like a denial-of-service. SAFE stays within what a single
 * page load would cost the target.
 */
export const SCAN_PROFILES: Record<ScanMode, ScanProfile> = {
  SAFE: {
    http: { requestBudget: 12, minIntervalMs: 400, timeoutMs: 10_000, maxBodyBytes: 256_000 },
    crawl: null,
    discovery: null,
    probeLegacyTls: false,
    enumerateSubdomains: false,
  },
  NORMAL: {
    http: { requestBudget: 90, minIntervalMs: 250, timeoutMs: 10_000, maxBodyBytes: 512_000 },
    crawl: { maxPages: 25, maxDepth: 2, maxScripts: 8, respectRobots: true },
    discovery: { tier: 'common', probeMethods: true, probeDisallowedPaths: false },
    probeLegacyTls: true,
    enumerateSubdomains: false,
  },
  AGGRESSIVE: {
    http: { requestBudget: 400, minIntervalMs: 120, timeoutMs: 12_000, maxBodyBytes: 1_000_000 },
    crawl: { maxPages: 120, maxDepth: 4, maxScripts: 25, respectRobots: true },
    discovery: { tier: 'extended', probeMethods: true, probeDisallowedPaths: true },
    probeLegacyTls: true,
    enumerateSubdomains: true,
  },
};

export type Stage = 'INITIALIZING' | 'DNS' | 'TLS' | 'HTTP' | 'CRAWL' | 'DISCOVERY' | 'SUBDOMAINS' | 'SCORING';

export const MODE_STAGES: Record<ScanMode, Stage[]> = {
  SAFE: ['INITIALIZING', 'DNS', 'TLS', 'HTTP', 'SCORING'],
  NORMAL: ['INITIALIZING', 'DNS', 'TLS', 'HTTP', 'CRAWL', 'DISCOVERY', 'SCORING'],
  AGGRESSIVE: ['INITIALIZING', 'DNS', 'TLS', 'HTTP', 'CRAWL', 'DISCOVERY', 'SUBDOMAINS', 'SCORING'],
};

export function stageProgress(mode: ScanMode, stage: Stage) {
  const stages = MODE_STAGES[mode];
  const index = stages.indexOf(stage);
  if (index < 0) return 0;
  return Math.round(((index + 1) / stages.length) * 100);
}
