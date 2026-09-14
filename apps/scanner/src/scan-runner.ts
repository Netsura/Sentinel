import { AssetType, Confidence, NotificationType, PrismaClient, ScanMode, ScanStatus, Severity } from '@prisma/client';
import type Redis from 'ioredis';
import { crawl } from './checks/crawler';
import { discoveryFindings } from './checks/discovery';
import { dnsFindings } from './checks/dns';
import { fetchLandingPage, httpFindings } from './checks/http';
import { subdomainFindings } from './checks/subdomains';
import { tlsFindings } from './checks/tls';
import { dedupeFindings, FindingInput, scoreFindings } from './lib/findings';
import { isIpLiteral, resolvePublicAddresses, SafeHttpClient } from './lib/net';
import { SCAN_PROFILES, Stage, stageProgress } from './lib/profiles';

export type ScanJobData = { scanId: string; workspaceId: string; assetId: string; mode: ScanMode };

export class ScanCancelledError extends Error {
  constructor() {
    super('Scan was cancelled');
  }
}

const SCORE_DROP_THRESHOLD = 10;

export class ScanRunner {
  constructor(private readonly prisma: PrismaClient, private readonly publisher: Redis) {}

  async run(data: ScanJobData) {
    const { scanId, assetId } = data;
    const scan = await this.prisma.scan.findUnique({ where: { id: scanId }, include: { asset: true } });
    if (!scan || scan.assetId !== assetId) throw new Error('Scan target no longer exists');
    if (scan.status === ScanStatus.CANCELLED) throw new ScanCancelledError();
    if (scan.status === ScanStatus.COMPLETED || scan.status === ScanStatus.FAILED) {
      return { score: scan.score ?? 0, findings: 0, requests: 0, skipped: true };
    }

    const mode = scan.mode;
    const profile = SCAN_PROFILES[mode];
    const hostname = scan.asset.value;
    const isIp = scan.asset.type === AssetType.IP || isIpLiteral(hostname);

    await this.begin(scanId);
    await this.stage(scanId, mode, 'INITIALIZING');

    const addresses = await resolvePublicAddresses(hostname);
    const client = new SafeHttpClient(hostname, addresses, profile.http);
    const findings: FindingInput[] = [];

    await this.stage(scanId, mode, 'DNS');
    findings.push(...(await dnsFindings(hostname, addresses, isIp)));

    await this.guardCancellation(scanId);
    await this.stage(scanId, mode, 'TLS');
    findings.push(...(await tlsFindings(hostname, profile.http.timeoutMs, profile.probeLegacyTls)));

    await this.guardCancellation(scanId);
    await this.stage(scanId, mode, 'HTTP');
    const { response: landing, chain } = await fetchLandingPage(client, hostname);
    findings.push(...(await httpFindings(client, hostname, landing)));
    if (chain.length) {
      findings.push({
        title: 'Landing page redirect chain',
        description: 'Redirects followed to reach the page that header checks were applied to.',
        severity: Severity.INFO,
        confidence: Confidence.HIGH,
        category: 'HTTP Configuration',
        evidence: `Redirect chain: ${chain.join(' -> ')}`,
        recommendation: 'Collapse long redirect chains to reduce latency and downgrade opportunities.',
      });
    }

    let disallowedPaths: string[] = [];

    if (profile.crawl && landing) {
      await this.guardCancellation(scanId);
      await this.stage(scanId, mode, 'CRAWL');
      const result = await crawl(client, hostname, profile.crawl, landing);
      findings.push(...result.findings);
      disallowedPaths = result.disallowedPaths;
    }

    if (profile.discovery) {
      await this.guardCancellation(scanId);
      await this.stage(scanId, mode, 'DISCOVERY');
      findings.push(...(await discoveryFindings(client, profile.discovery, disallowedPaths)));
    }

    if (profile.enumerateSubdomains && !isIp) {
      await this.guardCancellation(scanId);
      await this.stage(scanId, mode, 'SUBDOMAINS');
      findings.push(...(await subdomainFindings(hostname)));
    }

    await this.guardCancellation(scanId);
    await this.stage(scanId, mode, 'SCORING');

    const deduped = dedupeFindings(findings);
    const score = scoreFindings(deduped);
    await this.persist(scan.workspaceId, scan.assetId, scanId, deduped);
    await this.complete(scanId, score, deduped, client.used);

    return { score, findings: deduped.length, requests: client.used, skipped: false };
  }

  private async begin(scanId: string) {
    await this.prisma.scan.update({
      where: { id: scanId },
      data: { status: ScanStatus.RUNNING, stage: 'INITIALIZING', progress: 1, startedAt: new Date() },
    });
  }

  private async stage(scanId: string, mode: ScanMode, stage: Stage) {
    const progress = stageProgress(mode, stage);
    await this.prisma.scan.update({ where: { id: scanId }, data: { stage, progress } });
    await this.publish(scanId, stage, progress);
  }

  private async publish(scanId: string, stage: string, progress: number) {
    if (this.publisher.status === 'wait' || this.publisher.status === 'close' || this.publisher.status === 'end') {
      await this.publisher.connect().catch(() => undefined);
    }
    await this.publisher.publish('scan.progress', JSON.stringify({ scanId, stage, progress })).catch(() => undefined);
  }

  /** Cancellation removes the queue job, but a scan already in flight has to notice on its own. */
  private async guardCancellation(scanId: string) {
    const scan = await this.prisma.scan.findUnique({ where: { id: scanId }, select: { status: true } });
    if (scan?.status === ScanStatus.CANCELLED) throw new ScanCancelledError();
  }

  private async persist(workspaceId: string, assetId: string, scanId: string, findings: FindingInput[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.finding.deleteMany({ where: { scanId } });
      if (!findings.length) return;
      await tx.finding.createMany({
        data: findings.map((finding) => ({ ...finding, scanId, workspaceId, assetId })),
      });
    });
  }

  private async complete(scanId: string, score: number, findings: FindingInput[], requests: number) {
    const claimed = await this.prisma.scan.updateMany({
      where: { id: scanId, status: { notIn: [ScanStatus.COMPLETED, ScanStatus.CANCELLED, ScanStatus.FAILED] } },
      data: { status: ScanStatus.COMPLETED, stage: 'COMPLETED', progress: 100, score, completedAt: new Date() },
    });
    if (claimed.count === 0) return;

    const scan = await this.prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      include: { asset: { select: { id: true, value: true, securityScore: true } } },
    });

    const previousScore = scan.asset.securityScore;

    await this.prisma.asset.update({
      where: { id: scan.assetId },
      data: { securityScore: score, lastScanAt: new Date() },
    });

    const notifications: Array<{ type: NotificationType; title: string; message: string }> = [
      {
        type: NotificationType.SCAN_COMPLETED,
        title: 'Scan completed',
        message: `The ${scan.mode.toLowerCase()} scan of ${scan.asset.value} finished with a score of ${score} from ${findings.length} finding(s) across ${requests} request(s).`,
      },
    ];

    const urgent = findings.filter((finding) => finding.severity === Severity.CRITICAL || finding.severity === Severity.HIGH);
    if (urgent.length) {
      notifications.push({
        type: NotificationType.CRITICAL_FINDING,
        title: `${urgent.length} high-severity finding(s) on ${scan.asset.value}`,
        message: `Most severe: ${urgent[0].title}. Review the findings view for evidence and remediation guidance.`,
      });
    }

    if (previousScore !== null && score <= previousScore - SCORE_DROP_THRESHOLD) {
      notifications.push({
        type: NotificationType.SCORE_DROP,
        title: `Security score dropped on ${scan.asset.value}`,
        message: `The score fell from ${previousScore} to ${score} since the previous scan.`,
      });
    }

    await this.prisma.notification.createMany({
      data: notifications.map((notification) => ({ ...notification, workspaceId: scan.workspaceId, userId: scan.startedById })),
    });

    await this.publish(scanId, 'COMPLETED', 100);
  }
}
