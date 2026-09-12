import { Confidence, Severity } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { FindingInput, truncateEvidence } from '../lib/findings';
import { SafeHttpClient } from '../lib/net';
import { DiscoveryProfile } from '../lib/profiles';

const CATEGORY_EXPOSURE = 'Exposed Artifact';
const CATEGORY_DISCOVERY = 'Endpoint Discovery';
const CATEGORY_CONFIG = 'HTTP Configuration';

type Tier = 'common' | 'extended';

type PathProbe = {
  path: string;
  title: string;
  description: string;
  severity: Severity;
  recommendation: string;
  /** Body must match for the probe to count, which suppresses soft-404 pages. */
  signature?: RegExp;
  /** For binary artifacts the scanner never reads: require a plausible body size instead. */
  minBytes?: number;
  tier: Tier;
};

const PATH_PROBES: PathProbe[] = [
  {
    path: '/.git/HEAD',
    title: 'Git repository exposed',
    description: 'The .git directory is served publicly, which can allow full source history reconstruction.',
    severity: Severity.CRITICAL,
    recommendation: 'Block access to .git at the web server and deploy from build artifacts rather than a working clone.',
    signature: /^ref:\s+refs\//m,
    tier: 'common',
  },
  {
    path: '/.git/config',
    title: 'Git configuration exposed',
    description: 'The repository configuration is readable and may disclose remote URLs and credentials.',
    severity: Severity.HIGH,
    recommendation: 'Block access to the .git directory entirely.',
    signature: /\[core\]|\[remote\s/,
    tier: 'common',
  },
  {
    path: '/.env',
    title: 'Environment file exposed',
    description: 'A .env file is publicly readable and typically contains database credentials and API keys.',
    severity: Severity.CRITICAL,
    recommendation: 'Remove the file from the web root, rotate every secret it contained, and block dotfiles.',
    signature: /^\s*(?:[A-Z][A-Z0-9_]*\s*=|APP_|DB_|DATABASE_|AWS_|SECRET)/m,
    tier: 'common',
  },
  {
    path: '/server-status',
    title: 'Apache server-status exposed',
    description: 'The Apache status page is public and reveals request URLs, client addresses, and server internals.',
    severity: Severity.MEDIUM,
    recommendation: 'Restrict mod_status to localhost or disable it.',
    signature: /Apache Server Status|Server uptime/i,
    tier: 'common',
  },
  {
    path: '/phpinfo.php',
    title: 'phpinfo page exposed',
    description: 'A phpinfo page discloses the full PHP configuration, loaded modules, and environment variables.',
    severity: Severity.HIGH,
    recommendation: 'Delete the phpinfo file from the web root.',
    signature: /phpinfo\(\)|PHP Version\s*<\/td>/i,
    tier: 'common',
  },
  {
    path: '/.svn/entries',
    title: 'Subversion metadata exposed',
    description: 'Subversion working-copy metadata is readable and can disclose source structure.',
    severity: Severity.HIGH,
    recommendation: 'Block access to .svn directories.',
    signature: /^\d+|dir$/m,
    tier: 'extended',
  },
  {
    path: '/.htpasswd',
    title: 'htpasswd file exposed',
    description: 'An Apache password file is publicly readable, exposing usernames and password hashes.',
    severity: Severity.CRITICAL,
    recommendation: 'Move the file outside the web root, block dotfiles, and reset every listed credential.',
    signature: /^[^:\s]+:[$.\w/]+$/m,
    tier: 'extended',
  },
  {
    path: '/web.config',
    title: 'IIS configuration exposed',
    description: 'The IIS configuration file is readable and may contain connection strings.',
    severity: Severity.HIGH,
    recommendation: 'Block access to web.config and rotate any credentials it contains.',
    signature: /<configuration[\s>]/i,
    tier: 'extended',
  },
  {
    path: '/wp-config.php.bak',
    title: 'WordPress configuration backup exposed',
    description: 'A backup of wp-config.php is readable as plaintext, exposing database credentials.',
    severity: Severity.CRITICAL,
    recommendation: 'Delete the backup, rotate the database credentials, and block .bak files.',
    signature: /DB_PASSWORD|DB_NAME/,
    tier: 'extended',
  },
  {
    path: '/config.php.bak',
    title: 'PHP configuration backup exposed',
    description: 'A configuration backup is served as plaintext instead of being executed.',
    severity: Severity.CRITICAL,
    recommendation: 'Delete the backup file and rotate any credentials it contained.',
    signature: /\$(?:db|database|password|config)|define\s*\(/i,
    tier: 'extended',
  },
  {
    path: '/database.yml',
    title: 'Database configuration exposed',
    description: 'A Rails-style database configuration file is publicly readable.',
    severity: Severity.CRITICAL,
    recommendation: 'Remove the file from the web root and rotate the database credentials.',
    signature: /adapter:|password:/,
    tier: 'extended',
  },
  {
    path: '/.npmrc',
    title: 'npm credentials file exposed',
    description: 'An .npmrc file is readable and may contain a registry authentication token.',
    severity: Severity.HIGH,
    recommendation: 'Remove the file from the web root and revoke the token.',
    signature: /_authToken|registry=/,
    tier: 'extended',
  },
  {
    path: '/docker-compose.yml',
    title: 'Docker Compose file exposed',
    description: 'The Compose definition is readable and discloses service topology and environment values.',
    severity: Severity.MEDIUM,
    recommendation: 'Remove deployment manifests from the web root.',
    signature: /^services:/m,
    tier: 'extended',
  },
  {
    path: '/.aws/credentials',
    title: 'AWS credentials file exposed',
    description: 'An AWS shared credentials file is publicly readable.',
    severity: Severity.CRITICAL,
    recommendation: 'Delete the file, rotate the access keys immediately, and audit CloudTrail for misuse.',
    signature: /aws_access_key_id/i,
    tier: 'extended',
  },
  {
    path: '/id_rsa',
    title: 'Private SSH key exposed',
    description: 'A private key file is served publicly.',
    severity: Severity.CRITICAL,
    recommendation: 'Remove the key, treat it as compromised, and rotate the corresponding authorized keys.',
    signature: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    tier: 'extended',
  },
  {
    path: '/actuator/env',
    title: 'Spring Boot actuator env endpoint exposed',
    description: 'The actuator environment endpoint discloses configuration properties, often including secrets.',
    severity: Severity.CRITICAL,
    recommendation: 'Restrict actuator endpoints to an internal management port with authentication.',
    signature: /"propertySources"|"activeProfiles"/,
    tier: 'extended',
  },
  {
    path: '/actuator',
    title: 'Spring Boot actuator exposed',
    description: 'The actuator index is reachable without authentication.',
    severity: Severity.MEDIUM,
    recommendation: 'Require authentication for actuator endpoints and expose only health checks.',
    signature: /"_links"/,
    tier: 'extended',
  },
  {
    path: '/elmah.axd',
    title: 'ELMAH error log exposed',
    description: 'The ELMAH error log handler is reachable and discloses stack traces and request data.',
    severity: Severity.HIGH,
    recommendation: 'Restrict elmah.axd to authenticated administrators.',
    signature: /Error Log for|ELMAH/i,
    tier: 'extended',
  },
  {
    path: '/_profiler',
    title: 'Symfony profiler exposed',
    description: 'The Symfony development profiler is reachable in a public environment.',
    severity: Severity.HIGH,
    recommendation: 'Disable the profiler bundle outside development environments.',
    signature: /Symfony Profiler|sf-profiler/i,
    tier: 'extended',
  },
  {
    path: '/telescope/requests',
    title: 'Laravel Telescope exposed',
    description: 'Laravel Telescope is reachable and records requests, queries, and credentials.',
    severity: Severity.HIGH,
    recommendation: 'Gate Telescope behind authentication or disable it in production.',
    signature: /Telescope|telescope/,
    tier: 'extended',
  },
  {
    path: '/dump.sql',
    title: 'Database dump exposed',
    description: 'A SQL dump is publicly readable.',
    severity: Severity.CRITICAL,
    recommendation: 'Delete the dump from the web root and review access logs for prior downloads.',
    signature: /(?:INSERT INTO|CREATE TABLE|DROP TABLE)/i,
    tier: 'extended',
  },
  {
    path: '/backup.zip',
    title: 'Backup archive exposed',
    description: 'A backup archive is downloadable from the web root.',
    severity: Severity.HIGH,
    recommendation: 'Delete the archive and store backups outside the document root.',
    minBytes: 1024,
    tier: 'extended',
  },
  {
    path: '/.vscode/sftp.json',
    title: 'Editor deployment config exposed',
    description: 'An SFTP deployment configuration is readable and commonly contains a plaintext password.',
    severity: Severity.CRITICAL,
    recommendation: 'Remove the file and rotate the deployment credentials.',
    signature: /"host"|"password"/,
    tier: 'extended',
  },
  {
    path: '/graphql',
    title: 'GraphQL endpoint reachable',
    description: 'A GraphQL endpoint responded, which warrants a review of introspection and depth limiting.',
    severity: Severity.LOW,
    recommendation: 'Disable introspection in production and enforce query depth and complexity limits.',
    signature: /(?:"data"|"errors"|GraphQL|graphiql)/i,
    tier: 'extended',
  },
  {
    path: '/openapi.json',
    title: 'API schema published',
    description: 'A machine-readable API schema is publicly downloadable, which maps the full attack surface.',
    severity: Severity.LOW,
    recommendation: 'Restrict schema access to authenticated consumers if the API is not public.',
    signature: /"openapi"|"swagger"/,
    tier: 'extended',
  },
  {
    path: '/phpmyadmin/',
    title: 'phpMyAdmin interface exposed',
    description: 'A database administration interface is reachable from the public internet.',
    severity: Severity.MEDIUM,
    recommendation: 'Restrict administrative interfaces to a VPN or trusted address range.',
    signature: /phpMyAdmin/i,
    tier: 'extended',
  },
];

export async function discoveryFindings(client: SafeHttpClient, profile: DiscoveryProfile, disallowedPaths: string[]): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const baseline = await calibrateNotFound(client);

  const probes = PATH_PROBES.filter((probe) => profile.tier === 'extended' || probe.tier === 'common');

  for (const probe of probes) {
    if (client.exhausted) break;
    const response = await client.request(probe.path);
    if (!response || response.status !== 200) continue;
    if (baseline.softNotFound && baseline.bodyLength > 0 && Math.abs(response.body.length - baseline.bodyLength) < 32) continue;
    if (probe.signature && !probe.signature.test(response.body)) continue;
    if (!probe.signature && probe.minBytes) {
      const size = response.contentLength || response.body.length;
      if (size < probe.minBytes || /text\/html/i.test(response.contentType)) continue;
    }

    findings.push({
      title: probe.title,
      description: probe.description,
      severity: probe.severity,
      confidence: probe.signature ? Confidence.HIGH : Confidence.MEDIUM,
      category: CATEGORY_EXPOSURE,
      evidence: truncateEvidence(`GET ${probe.path} returned ${response.status} (${response.contentType || 'unknown type'}) matching the expected artifact signature`),
      recommendation: probe.recommendation,
    });
  }

  findings.push(...(await securityTxtFindings(client)));
  if (profile.probeMethods) findings.push(...(await methodFindings(client)));
  if (profile.probeDisallowedPaths) findings.push(...(await disallowedPathFindings(client, disallowedPaths, baseline)));

  return findings;
}

type Baseline = { softNotFound: boolean; bodyLength: number };

/**
 * Many applications answer unknown paths with a styled 200 page. Fetching a
 * path that cannot exist establishes what "not found" looks like so the probes
 * above do not report every 200 as an exposed artifact.
 */
async function calibrateNotFound(client: SafeHttpClient): Promise<Baseline> {
  const response = await client.request(`/sentinel-probe-${randomBytes(8).toString('hex')}`);
  if (!response) return { softNotFound: false, bodyLength: 0 };
  return { softNotFound: response.status === 200, bodyLength: response.body.length };
}

async function securityTxtFindings(client: SafeHttpClient): Promise<FindingInput[]> {
  const response = await client.request('/.well-known/security.txt');
  if (response?.status === 200 && /contact:/i.test(response.body)) return [];

  return [
    {
      title: 'No security.txt published',
      description: 'The target does not publish a security.txt, so researchers have no documented disclosure channel.',
      severity: Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY_DISCOVERY,
      evidence: '/.well-known/security.txt was absent or contained no Contact field',
      recommendation: 'Publish /.well-known/security.txt with a Contact field and a policy URL.',
    },
  ];
}

async function methodFindings(client: SafeHttpClient): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const options = await client.request('/', { method: 'OPTIONS', readBody: false });
  const allow = options?.headers.get('allow') ?? options?.headers.get('access-control-allow-methods');

  if (allow) {
    const methods = allow.split(',').map((method) => method.trim().toUpperCase());
    const risky = methods.filter((method) => ['PUT', 'DELETE', 'PATCH', 'TRACE', 'CONNECT'].includes(method));

    findings.push({
      title: 'HTTP methods advertised by the server',
      description: 'Methods the server reports as allowed on the document root.',
      severity: risky.length ? Severity.LOW : Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONFIG,
      evidence: truncateEvidence(`Allowed methods: ${methods.join(', ')}${risky.length ? `; state-changing methods advertised: ${risky.join(', ')}` : ''}`),
      recommendation: risky.length
        ? 'Disable methods the application does not need, especially TRACE and CONNECT.'
        : 'No action required.',
    });
  }

  // TRACE is safe to issue: it echoes the request without changing server state.
  const trace = await client.request('/', { method: 'TRACE', readBody: true });
  if (trace && trace.status === 200 && /TRACE\s+\//i.test(trace.body)) {
    findings.push({
      title: 'HTTP TRACE method enabled',
      description: 'The server echoes requests back via TRACE, which historically enabled cross-site tracing attacks.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONFIG,
      evidence: truncateEvidence(`TRACE / returned ${trace.status} and echoed the request line`),
      recommendation: 'Disable the TRACE method in the web server configuration.',
    });
  }

  return findings;
}

async function disallowedPathFindings(client: SafeHttpClient, disallowedPaths: string[], baseline: Baseline): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  for (const path of disallowedPaths.slice(0, 15)) {
    if (client.exhausted) break;
    const candidate = path.replace(/\*/g, '').trim();
    if (!candidate.startsWith('/')) continue;

    const response = await client.request(candidate, { readBody: true });
    if (!response || response.status !== 200) continue;
    if (baseline.softNotFound && baseline.bodyLength > 0 && Math.abs(response.body.length - baseline.bodyLength) < 32) continue;

    findings.push({
      title: 'Path disallowed in robots.txt is publicly reachable',
      description: 'A path the owner asked crawlers to avoid returns content to unauthenticated requests.',
      severity: Severity.LOW,
      confidence: Confidence.MEDIUM,
      category: CATEGORY_DISCOVERY,
      evidence: truncateEvidence(`GET ${candidate} returned ${response.status} despite being disallowed in robots.txt`),
      recommendation: 'Enforce authorization on the path rather than relying on robots.txt to hide it.',
    });
  }

  return findings;
}
