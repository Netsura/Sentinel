import { PrismaClient, ScanMode, ScanStatus, Severity, Confidence } from '@prisma/client';
import { Job, Worker } from 'bullmq';
import { promises as dns } from 'node:dns';
import tls from 'node:tls';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redisConnection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' } as never;
const publisher = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true });

type ScanJob = { scanId: string; workspaceId: string; assetId: string; mode: ScanMode };
type FindingInput = { title: string; description: string; severity: Severity; confidence: Confidence; category: string; evidence: string; recommendation: string };

new Worker<ScanJob>('scan', async (job) => runScan(job), { connection: redisConnection, concurrency: 2 });

async function runScan(job: Job<ScanJob>) {
  const { scanId, assetId } = job.data;
  const scan = await prisma.scan.findUnique({ where: { id: scanId }, include: { asset: true } });
  if (!scan || scan.assetId !== assetId) throw new Error('Scan target no longer exists');

  await update(scanId, ScanStatus.RUNNING, 'INITIALIZING', 5);
  const hostname = scan.asset.value;
  const addresses = await resolvePublicAddresses(hostname);

  await update(scanId, ScanStatus.RUNNING, 'DNS', 20);
  const findings: FindingInput[] = [];
  await update(scanId, ScanStatus.RUNNING, 'TLS', 35);
  findings.push(...await tlsFindings(hostname));
  let response: Response;
  try {
    response = await fetch(`https://${hostname}`, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Sentinel-SafeScanner/1.0' } });
  } catch {
    findings.push({ title: 'HTTPS endpoint unavailable', description: 'The target did not complete a safe HTTPS request.', severity: Severity.MEDIUM, confidence: Confidence.MEDIUM, category: 'Availability', evidence: `https://${hostname} did not return a response`, recommendation: 'Ensure the service is reachable over HTTPS and presents a valid certificate.' });
    await persist(scanId, findings);
    return complete(scanId, 45);
  }

  await update(scanId, ScanStatus.RUNNING, 'HTTP', 55);
  const requestAddresses = await resolvePublicAddresses(hostname);
  if (addresses.join('|') !== requestAddresses.join('|')) throw new Error('Target DNS changed during scan; refusing request');
  const checks = [
    ['Content-Security-Policy', Severity.MEDIUM, 'Configure a restrictive Content-Security-Policy.'],
    ['Strict-Transport-Security', Severity.LOW, 'Enable HSTS after confirming HTTPS is available everywhere.'],
    ['X-Content-Type-Options', Severity.LOW, 'Set X-Content-Type-Options to nosniff.'],
  ] as const;
  for (const [header, severity, recommendation] of checks) {
    if (!response.headers.get(header)) findings.push({ title: `Missing ${header}`, description: `The ${header} response header was not present.`, severity, confidence: Confidence.HIGH, category: 'HTTP Configuration', evidence: `${header} was absent from the HTTPS response`, recommendation });
  }
  const server = response.headers.get('server');
  if (server) findings.push({ title: 'Server technology disclosure', description: 'The response exposes a server implementation header.', severity: Severity.INFO, confidence: Confidence.HIGH, category: 'Information Disclosure', evidence: `Server: ${server}`, recommendation: 'Remove or minimize server-identifying response headers.' });

  await update(scanId, ScanStatus.RUNNING, 'SECURITY_CHECKS', 80);
  await persist(scanId, findings);
  return complete(scanId, score(findings));
}

async function tlsFindings(hostname: string): Promise<FindingInput[]> {
  try {
    const result = await new Promise<{ certificate: tls.PeerCertificate; protocol?: string }>((resolve, reject) => {
      const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 10000 }, () => {
        const peer = socket.getPeerCertificate(true);
        const protocol = socket.getProtocol() ?? undefined;
        socket.end();
        resolve({ certificate: peer, protocol });
      });
      socket.once('error', reject);
      socket.once('timeout', () => { socket.destroy(); reject(new Error('TLS timeout')); });
    });
    const { certificate, protocol } = result;
    if (!certificate.valid_to) throw new Error('Certificate metadata unavailable');
    if (protocol === 'TLSv1' || protocol === 'TLSv1.1') return [{ title: 'Legacy TLS protocol enabled', description: 'The target negotiated a deprecated TLS protocol.', severity: Severity.HIGH, confidence: Confidence.HIGH, category: 'TLS', evidence: `Negotiated protocol: ${protocol}`, recommendation: 'Disable TLS 1.0 and TLS 1.1 and require TLS 1.2 or newer.' }];
    const expiry = new Date(certificate.valid_to);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
    if (daysUntilExpiry <= 30) return [{ title: 'TLS certificate expires soon', description: 'The certificate expires within 30 days.', severity: daysUntilExpiry <= 7 ? Severity.HIGH : Severity.MEDIUM, confidence: Confidence.HIGH, category: 'TLS', evidence: `Certificate issued by ${certificate.issuer?.O ?? 'unknown'} expires on ${certificate.valid_to}; SAN: ${certificate.subjectaltname ?? 'unavailable'}`, recommendation: 'Renew the certificate before expiration and verify the complete certificate chain.' }];
    return [];
  } catch (error) {
    return [{ title: 'TLS certificate validation failed', description: 'The target did not present a usable TLS certificate.', severity: Severity.HIGH, confidence: Confidence.HIGH, category: 'TLS', evidence: error instanceof Error ? error.message : 'TLS handshake failed', recommendation: 'Install a valid certificate for the target hostname and serve the complete chain.' }];
  }
}

async function persist(scanId: string, findings: FindingInput[]) {
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId }, select: { workspaceId: true, assetId: true } });
  if (findings.length) await prisma.finding.createMany({ data: findings.map((finding) => ({ ...finding, scanId, workspaceId: scan.workspaceId, assetId: scan.assetId })) });
}

async function complete(scanId: string, scoreValue: number) {
  const scan = await prisma.scan.update({ where: { id: scanId }, data: { status: ScanStatus.COMPLETED, stage: 'COMPLETED', progress: 100, score: scoreValue, completedAt: new Date() } });
  await prisma.notification.create({ data: { workspaceId: scan.workspaceId, userId: scan.startedById, type: 'SCAN_COMPLETED', title: 'Scan completed', message: `The ${scan.mode.toLowerCase()} scan is complete with a score of ${scoreValue}.` } });
}

async function update(scanId: string, status: ScanStatus, stage: string, progress: number) {
  await prisma.scan.update({ where: { id: scanId }, data: { status, stage, progress, startedAt: new Date() } });
  if (publisher.status === 'wait') await publisher.connect();
  await publisher.publish('scan.progress', JSON.stringify({ scanId, stage, progress }));
}

function score(findings: FindingInput[]) {
  const weights = { CRITICAL: 10, HIGH: 7, MEDIUM: 4, LOW: 1, INFO: 0 } as const;
  const penalty = findings.reduce((total, finding) => total + weights[finding.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty * 3));
}

function isPrivateAddress(address: string) {
  if (address.includes(':')) return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
  const octets = address.split('.').map(Number);
  if (octets.length !== 4) return true;
  const [first, second] = octets;
  return first === 10 || first === 127 || first === 0 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

async function resolvePublicAddresses(hostname: string) {
  const addresses = (await dns.lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address).sort();
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('Resolved target is not publicly routable');
  return addresses;
}

process.once('SIGTERM', async () => { await publisher.quit(); await prisma.$disconnect(); process.exit(0); });
