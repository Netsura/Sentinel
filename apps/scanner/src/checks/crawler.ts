import { Confidence, Severity } from '@prisma/client';
import { FindingInput, truncateEvidence } from '../lib/findings';
import { SafeHttpClient, SafeResponse } from '../lib/net';
import { CrawlProfile } from '../lib/profiles';

const CATEGORY_DISCOVERY = 'Endpoint Discovery';
const CATEGORY_CONTENT = 'Content Security';
const CATEGORY_SECRETS = 'Secret Exposure';

const SKIPPED_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|mp3|pdf|zip|gz|tar|dmg|exe)$/i;
const LINK_PATTERN = /(?:href|src|action)\s*=\s*["']([^"'>\s]+)["']/gi;
const SCRIPT_PATTERN = /<script[^>]+src\s*=\s*["']([^"'>\s]+)["']/gi;
const FORM_PATTERN = /<form\b[\s\S]*?<\/form>/gi;
const ENDPOINT_PATTERN = /["'`](\/(?:api|v\d|graphql|rest|internal|admin)\/[A-Za-z0-9\-_/.{}$:]{1,80})["'`]/g;

const SECRET_PATTERNS = [
  { name: 'AWS access key ID', pattern: /\bAKIA[0-9A-Z]{16}\b/g, severity: Severity.CRITICAL },
  { name: 'AWS secret access key', pattern: /\baws_secret_access_key["'\s:=]+([A-Za-z0-9/+]{40})\b/gi, severity: Severity.CRITICAL },
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/g, severity: Severity.HIGH },
  { name: 'Slack token', pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,72}\b/g, severity: Severity.CRITICAL },
  { name: 'Stripe live secret key', pattern: /\bsk_live_[0-9A-Za-z]{16,64}\b/g, severity: Severity.CRITICAL },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, severity: Severity.CRITICAL },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, severity: Severity.CRITICAL },
  { name: 'Hardcoded credential assignment', pattern: /\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|password)["'\s]*[:=]\s*["']([^"'\s]{12,80})["']/gi, severity: Severity.HIGH },
] as const;

export type CrawlResult = {
  findings: FindingInput[];
  visited: string[];
  scripts: string[];
  endpoints: string[];
  disallowedPaths: string[];
};

export async function crawl(client: SafeHttpClient, hostname: string, profile: CrawlProfile, landing: SafeResponse | null): Promise<CrawlResult> {
  const findings: FindingInput[] = [];
  const disallowedPaths = await readRobots(client, findings);
  const blocked = profile.respectRobots ? disallowedPaths : [];

  const queue: Array<{ path: string; depth: number }> = [{ path: '/', depth: 0 }];
  const visited = new Set<string>();
  const scripts = new Set<string>();
  const endpoints = new Set<string>();

  while (queue.length && visited.size < profile.maxPages && !client.exhausted) {
    const next = queue.shift();
    if (!next) break;
    const { path, depth } = next;
    const normalized = normalizePath(path);
    if (visited.has(normalized) || isBlocked(normalized, blocked)) continue;
    visited.add(normalized);

    // The landing page was already fetched during the HTTP stage; reuse it.
    const response = normalized === '/' && landing ? landing : await client.request(normalized);
    if (!response || !response.body) continue;

    findings.push(...pageFindings(response));
    collectSecrets(response.body, response.url, findings);

    for (const endpoint of matchAll(response.body, ENDPOINT_PATTERN)) endpoints.add(endpoint);

    for (const script of matchAll(response.body, SCRIPT_PATTERN)) {
      const resolved = resolveSameHost(script, response.url, hostname);
      if (resolved && scripts.size < profile.maxScripts) scripts.add(resolved);
    }

    if (depth >= profile.maxDepth) continue;

    for (const link of matchAll(response.body, LINK_PATTERN)) {
      const resolved = resolveSameHost(link, response.url, hostname);
      if (!resolved || SKIPPED_EXTENSIONS.test(resolved)) continue;
      if (!visited.has(normalizePath(resolved)) && queue.length + visited.size < profile.maxPages * 2) {
        queue.push({ path: resolved, depth: depth + 1 });
      }
    }
  }

  findings.push(...(await inspectScripts(client, [...scripts], endpoints)));

  if (endpoints.size) {
    findings.push({
      title: 'Application endpoints discovered',
      description: 'Endpoint paths referenced by the crawled pages and scripts.',
      severity: Severity.INFO,
      confidence: Confidence.MEDIUM,
      category: CATEGORY_DISCOVERY,
      evidence: truncateEvidence(`${endpoints.size} endpoint(s): ${[...endpoints].slice(0, 25).join(', ')}`),
      recommendation: 'Confirm each endpoint enforces authentication and authorization independently.',
    });
  }

  findings.push({
    title: 'Crawl coverage summary',
    description: 'Pages and scripts reviewed during this scan.',
    severity: Severity.INFO,
    confidence: Confidence.HIGH,
    category: CATEGORY_DISCOVERY,
    evidence: truncateEvidence(`Crawled ${visited.size} page(s) and ${scripts.size} script(s); ${client.used} request(s) used`),
    recommendation: 'No action required.',
  });

  return { findings, visited: [...visited], scripts: [...scripts], endpoints: [...endpoints], disallowedPaths };
}

async function readRobots(client: SafeHttpClient, findings: FindingInput[]) {
  const response = await client.request('/robots.txt');
  if (!response || response.status !== 200 || !response.body) return [];

  const disallowed: string[] = [];
  let appliesToUs = false;

  for (const rawLine of response.body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') appliesToUs = value === '*' || /sentinel/i.test(value);
    else if (key === 'disallow' && appliesToUs && value && value !== '/') disallowed.push(value);
  }

  if (disallowed.length) {
    findings.push({
      title: 'robots.txt discloses restricted paths',
      description: 'robots.txt enumerates paths the owner prefers to keep out of search indexes, which also advertises them to attackers.',
      severity: Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY_DISCOVERY,
      evidence: truncateEvidence(`Disallowed entries: ${disallowed.slice(0, 20).join(', ')}`),
      recommendation: 'Do not rely on robots.txt to protect sensitive paths; enforce authorization on them instead.',
    });
  }

  return disallowed;
}

function pageFindings(response: SafeResponse): FindingInput[] {
  const findings: FindingInput[] = [];
  const body = response.body;

  if (/<title>\s*Index of \//i.test(body) || /<h1>\s*Index of \//i.test(body)) {
    findings.push({
      title: 'Directory listing enabled',
      description: 'The server returned an automatically generated index of directory contents.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONTENT,
      evidence: truncateEvidence(`${response.url} returned a generated directory index`),
      recommendation: 'Disable automatic directory indexing and serve an explicit index document.',
    });
  }

  const mixed = [...matchAll(body, LINK_PATTERN)].filter((link) => link.toLowerCase().startsWith('http://'));
  if (mixed.length) {
    findings.push({
      title: 'Mixed content references on HTTPS page',
      description: 'An HTTPS page references subresources over plaintext HTTP, which browsers block or downgrade.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONTENT,
      evidence: truncateEvidence(`${response.url} references ${mixed.length} plaintext URL(s): ${mixed.slice(0, 5).join(', ')}`),
      recommendation: 'Update all subresource references to HTTPS or protocol-relative URLs.',
    });
  }

  findings.push(...formFindings(response));

  if (/(?:Fatal error|Warning:\s*\w+\(\)|Traceback \(most recent call last\)|at [\w.$]+\([\w.]+\.java:\d+\)|System\.\w+Exception|ORA-\d{5}|SQLSTATE\[)/.test(body)) {
    findings.push({
      title: 'Verbose error output exposed',
      description: 'The response contains a stack trace or interpreter error, which reveals internal implementation detail.',
      severity: Severity.MEDIUM,
      confidence: Confidence.MEDIUM,
      category: CATEGORY_CONTENT,
      evidence: truncateEvidence(`${response.url} returned interpreter error output`),
      recommendation: 'Disable verbose errors in production and log them server-side instead.',
    });
  }

  return findings;
}

function formFindings(response: SafeResponse): FindingInput[] {
  const findings: FindingInput[] = [];

  for (const form of response.body.match(FORM_PATTERN) ?? []) {
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(form)?.[1] ?? '';
    const method = (/method\s*=\s*["']([^"']*)["']/i.exec(form)?.[1] ?? 'get').toLowerCase();
    const hasPassword = /type\s*=\s*["']password["']/i.test(form);

    if (action.toLowerCase().startsWith('http://')) {
      findings.push({
        title: 'Form submits over plaintext HTTP',
        description: 'A form posts its data to a plaintext HTTP endpoint, exposing submitted values in transit.',
        severity: hasPassword ? Severity.HIGH : Severity.MEDIUM,
        confidence: Confidence.HIGH,
        category: CATEGORY_CONTENT,
        evidence: truncateEvidence(`Form on ${response.url} submits to ${action}`),
        recommendation: 'Point the form action at an HTTPS URL.',
      });
    }

    if (hasPassword && method === 'get') {
      findings.push({
        title: 'Credential form uses GET',
        description: 'A form containing a password field submits with GET, which places the credential in the URL, browser history, and server logs.',
        severity: Severity.HIGH,
        confidence: Confidence.HIGH,
        category: CATEGORY_CONTENT,
        evidence: truncateEvidence(`Form on ${response.url} submits a password field using GET to ${action || 'the same URL'}`),
        recommendation: 'Change the form method to POST.',
      });
    }

    if (method === 'post' && !/type\s*=\s*["']hidden["']/i.test(form)) {
      findings.push({
        title: 'State-changing form has no anti-CSRF token',
        description: 'A POST form contains no hidden field, which suggests no synchronizer token protects it.',
        severity: Severity.LOW,
        confidence: Confidence.LOW,
        category: CATEGORY_CONTENT,
        evidence: truncateEvidence(`POST form on ${response.url} contains no hidden input`),
        recommendation: 'Include a per-session CSRF token in state-changing forms, or rely on SameSite cookies plus origin checks.',
      });
    }
  }

  return findings;
}

async function inspectScripts(client: SafeHttpClient, scripts: string[], endpoints: Set<string>): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  for (const script of scripts) {
    if (client.exhausted) break;
    const response = await client.request(script);
    if (!response || !response.body) continue;

    collectSecrets(response.body, response.url, findings);
    for (const endpoint of matchAll(response.body, ENDPOINT_PATTERN)) endpoints.add(endpoint);

    if (/\/\/# sourceMappingURL=.+\.map/.test(response.body)) {
      findings.push({
        title: 'JavaScript source map reference exposed',
        description: 'A bundled script points at a source map, which can expose original source code and file structure.',
        severity: Severity.LOW,
        confidence: Confidence.HIGH,
        category: CATEGORY_DISCOVERY,
        evidence: truncateEvidence(`${response.url} references a source map`),
        recommendation: 'Stop publishing source maps to production or restrict access to them.',
      });
    }
  }

  return findings;
}

function collectSecrets(body: string, url: string, findings: FindingInput[]) {
  for (const { name, pattern, severity } of SECRET_PATTERNS) {
    // Patterns are module-level and stateful; reset before reuse.
    pattern.lastIndex = 0;
    const match = pattern.exec(body);
    if (!match) continue;

    findings.push({
      title: `Possible ${name} exposed in client-side content`,
      description: 'A value matching a credential format was served to unauthenticated clients.',
      severity,
      confidence: Confidence.MEDIUM,
      category: CATEGORY_SECRETS,
      evidence: truncateEvidence(`${name} pattern matched in ${url}: ${redact(match[1] ?? match[0])}`),
      recommendation: 'Treat the value as compromised, rotate it, and move the secret behind a server-side proxy.',
    });
  }
}

function redact(value: string) {
  if (value.length <= 8) return `${value.slice(0, 2)}${'*'.repeat(Math.max(0, value.length - 2))}`;
  return `${value.slice(0, 4)}${'*'.repeat(8)}${value.slice(-4)}`;
}

function matchAll(body: string, pattern: RegExp) {
  const results = new Set<string>();
  const local = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (let match = local.exec(body); match; match = local.exec(body)) {
    if (match[1]) results.add(match[1]);
  }
  return [...results];
}

function resolveSameHost(candidate: string, base: string, hostname: string) {
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(candidate)) return null;
  try {
    const url = new URL(candidate, base);
    if (url.hostname.toLowerCase() !== hostname.toLowerCase()) return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function normalizePath(path: string) {
  const [withoutFragment] = path.split('#');
  const normalized = withoutFragment.replace(/\/{2,}/g, '/');
  if (!normalized) return '/';
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

function isBlocked(path: string, disallowed: string[]) {
  return disallowed.some((prefix) => path.startsWith(prefix));
}
