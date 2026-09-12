/**
 * Manual harness: runs the real check modules against a live host without
 * touching PostgreSQL or Redis. Not part of the build.
 *
 *   npx tsx apps/scanner/src/probe.manual.ts example.com NORMAL
 */
import { crawl } from './checks/crawler';
import { discoveryFindings } from './checks/discovery';
import { dnsFindings } from './checks/dns';
import { fetchLandingPage, httpFindings } from './checks/http';
import { subdomainFindings } from './checks/subdomains';
import { tlsFindings } from './checks/tls';
import { dedupeFindings, FindingInput, scoreFindings } from './lib/findings';
import { isIpLiteral, resolvePublicAddresses, SafeHttpClient } from './lib/net';
import { SCAN_PROFILES } from './lib/profiles';

async function main() {
  const hostname = process.argv[2] ?? 'example.com';
  const mode = (process.argv[3] ?? 'SAFE') as keyof typeof SCAN_PROFILES;
  const profile = SCAN_PROFILES[mode];
  const isIp = isIpLiteral(hostname);

  console.log(`\n=== ${mode} scan of ${hostname} ===`);
  const addresses = await resolvePublicAddresses(hostname);
  console.log(`resolved: ${addresses.join(', ')}`);

  const client = new SafeHttpClient(hostname, addresses, profile.http);
  const findings: FindingInput[] = [];

  findings.push(...(await dnsFindings(hostname, addresses, isIp)));
  console.log(`after DNS:       ${findings.length} findings`);

  findings.push(...(await tlsFindings(hostname, profile.http.timeoutMs, profile.probeLegacyTls)));
  console.log(`after TLS:       ${findings.length} findings`);

  const { response: landing } = await fetchLandingPage(client, hostname);
  findings.push(...(await httpFindings(client, hostname, landing)));
  console.log(`after HTTP:      ${findings.length} findings (${client.used} requests)`);

  let disallowed: string[] = [];
  if (profile.crawl && landing) {
    const result = await crawl(client, hostname, profile.crawl, landing);
    findings.push(...result.findings);
    disallowed = result.disallowedPaths;
    console.log(`after CRAWL:     ${findings.length} findings (${client.used} requests, ${result.visited.length} pages)`);
  }

  if (profile.discovery) {
    findings.push(...(await discoveryFindings(client, profile.discovery, disallowed)));
    console.log(`after DISCOVERY: ${findings.length} findings (${client.used} requests)`);
  }

  if (profile.enumerateSubdomains && !isIp) {
    findings.push(...(await subdomainFindings(hostname)));
    console.log(`after SUBDOMAIN: ${findings.length} findings`);
  }

  const deduped = dedupeFindings(findings);
  console.log(`\nscore: ${scoreFindings(deduped)}/100 from ${deduped.length} findings, ${client.used} requests\n`);

  for (const finding of deduped) {
    console.log(`  [${finding.severity.padEnd(8)}] ${finding.category}: ${finding.title}`);
    console.log(`             ${finding.evidence.slice(0, 150)}`);
  }
}

main().catch((error) => {
  console.error('probe failed:', error);
  process.exit(1);
});
