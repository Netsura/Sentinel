import { Confidence, Severity } from '@prisma/client';
import { FindingInput, truncateEvidence } from '../lib/findings';
import { isPrivateAddress } from '../lib/net';
import { resolveSubdomain } from './dns';

const CATEGORY = 'Attack Surface';
const CONCURRENCY = 8;

const SUBDOMAIN_WORDLIST = [
  'www', 'api', 'app', 'admin', 'dev', 'staging', 'stage', 'test', 'qa', 'uat',
  'mail', 'smtp', 'imap', 'webmail', 'vpn', 'remote', 'portal', 'dashboard', 'internal', 'intranet',
  'git', 'gitlab', 'jenkins', 'ci', 'build', 'registry', 'docker', 'grafana', 'kibana', 'prometheus',
  'db', 'database', 'mysql', 'postgres', 'redis', 'mongo', 'backup', 'files', 'ftp', 'sftp',
  'cdn', 'static', 'assets', 'media', 'img', 'download', 'docs', 'status', 'support', 'help',
  'beta', 'demo', 'sandbox', 'preview', 'legacy', 'old', 'new', 'm', 'mobile', 'shop',
] as const;

/**
 * Enumeration is DNS-only: it never sends HTTP traffic to the discovered hosts,
 * so a wide wordlist costs the target nothing and stays within the authorized
 * scope of the parent domain.
 */
export async function subdomainFindings(hostname: string): Promise<FindingInput[]> {
  const candidates = SUBDOMAIN_WORDLIST.map((label) => `${label}.${hostname}`);
  const resolved: Array<{ candidate: string; addresses: string[]; cname: string[] }> = [];

  for (let index = 0; index < candidates.length; index += CONCURRENCY) {
    const batch = candidates.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map((candidate) => resolveSubdomain(candidate)));
    resolved.push(...results.filter((result) => result.addresses.length || result.cname.length));
  }

  if (!resolved.length) return [];

  const findings: FindingInput[] = [
    {
      title: 'Subdomains discovered through DNS enumeration',
      description: 'Subdomains of the authorized asset that resolve in public DNS.',
      severity: Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`${resolved.length} of ${candidates.length} candidates resolved: ${resolved.map((result) => result.candidate).join(', ')}`),
      recommendation: 'Add each subdomain you intend to keep as a monitored asset, and remove DNS records you no longer use.',
    },
  ];

  const internal = resolved.filter((result) => result.addresses.some(isPrivateAddress));
  if (internal.length) {
    findings.push({
      title: 'Public DNS records point to private addresses',
      description: 'Subdomains resolve to RFC 1918 addresses, which leaks internal network layout and enables DNS rebinding.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(internal.map((result) => `${result.candidate} -> ${result.addresses.join(', ')}`).join('; ')),
      recommendation: 'Move internal name resolution to a split-horizon or private DNS zone.',
    });
  }

  const dangling = resolved.filter((result) => result.cname.length && !result.addresses.length);
  if (dangling.length) {
    findings.push({
      title: 'Dangling CNAME records may allow subdomain takeover',
      description: 'Subdomains delegate to a CNAME target that no longer resolves, which lets whoever claims that target serve content on your domain.',
      severity: Severity.HIGH,
      confidence: Confidence.MEDIUM,
      category: CATEGORY,
      evidence: truncateEvidence(dangling.map((result) => `${result.candidate} -> CNAME ${result.cname.join(', ')} (no address records)`).join('; ')),
      recommendation: 'Delete the DNS records or reclaim the referenced resource at the provider before someone else registers it.',
    });
  }

  return findings;
}
