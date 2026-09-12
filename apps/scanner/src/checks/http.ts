import { Confidence, Severity } from '@prisma/client';
import { FindingInput, truncateEvidence } from '../lib/findings';
import { SafeHttpClient, SafeResponse } from '../lib/net';

const CATEGORY_CONFIG = 'HTTP Configuration';
const CATEGORY_TRANSPORT = 'Transport Security';
const CATEGORY_DISCLOSURE = 'Information Disclosure';
const CATEGORY_AVAILABILITY = 'Availability';

const MISSING_HEADERS = [
  {
    header: 'Content-Security-Policy',
    severity: Severity.MEDIUM,
    description: 'Without a Content-Security-Policy the browser has no instruction limiting where scripts may load from.',
    recommendation: 'Configure a restrictive Content-Security-Policy and tighten it until inline script is unnecessary.',
  },
  {
    header: 'Strict-Transport-Security',
    severity: Severity.MEDIUM,
    description: 'Without HSTS a browser may be downgraded to plaintext HTTP on the first request.',
    recommendation: 'Enable HSTS once you have confirmed HTTPS works on every hostname you serve.',
  },
  {
    header: 'X-Content-Type-Options',
    severity: Severity.LOW,
    description: 'Browsers may MIME-sniff responses and treat data as executable script.',
    recommendation: 'Set X-Content-Type-Options to nosniff.',
  },
  {
    header: 'X-Frame-Options',
    severity: Severity.LOW,
    description: 'The response does not state whether it may be framed, which enables clickjacking when no CSP frame-ancestors is present.',
    recommendation: 'Set X-Frame-Options to DENY or define frame-ancestors in your Content-Security-Policy.',
  },
  {
    header: 'Referrer-Policy',
    severity: Severity.LOW,
    description: 'Without a referrer policy, full URLs may leak to third parties through the Referer header.',
    recommendation: 'Set Referrer-Policy to strict-origin-when-cross-origin or no-referrer.',
  },
] as const;

const DISCLOSURE_HEADERS = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator', 'x-drupal-cache', 'x-runtime'];

/** Follows same-host redirects so header checks apply to the page users actually land on. */
export async function fetchLandingPage(client: SafeHttpClient, hostname: string, maxHops = 3) {
  let response = await client.request('/');
  const chain: string[] = [];

  for (let hop = 0; hop < maxHops; hop += 1) {
    if (!response || response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) break;

    let next: URL;
    try {
      next = new URL(location, response.url);
    } catch {
      break;
    }
    if (next.hostname.toLowerCase() !== hostname.toLowerCase() || next.protocol !== 'https:') break;

    chain.push(`${response.status} -> ${next.pathname}${next.search}`);
    response = await client.request(`${next.pathname}${next.search}`);
  }

  return { response, chain };
}

export async function httpFindings(client: SafeHttpClient, hostname: string, landing: SafeResponse | null): Promise<FindingInput[]> {
  if (!landing) {
    return [
      {
        title: 'HTTPS endpoint unavailable',
        description: 'The target did not return a response to a safe HTTPS request.',
        severity: Severity.MEDIUM,
        confidence: Confidence.MEDIUM,
        category: CATEGORY_AVAILABILITY,
        evidence: truncateEvidence(`https://${hostname}/ did not return a response`),
        recommendation: 'Ensure the service is reachable over HTTPS and presents a valid certificate.',
      },
    ];
  }

  const findings: FindingInput[] = [
    {
      title: 'HTTPS endpoint reachable',
      description: 'Baseline response captured from the target landing page.',
      severity: Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY_AVAILABILITY,
      evidence: truncateEvidence(`GET ${landing.url} returned ${landing.status} (${landing.contentType || 'no content-type'})`),
      recommendation: 'No action required.',
    },
  ];

  findings.push(...missingHeaderFindings(landing));
  findings.push(...contentSecurityPolicyFindings(landing));
  findings.push(...strictTransportSecurityFindings(landing));
  findings.push(...cookieFindings(landing));
  findings.push(...corsFindings(landing));
  findings.push(...disclosureFindings(landing));
  findings.push(...(await plaintextRedirectFindings(client, hostname)));

  return findings;
}

function missingHeaderFindings(response: SafeResponse): FindingInput[] {
  const csp = response.headers.get('content-security-policy');

  return MISSING_HEADERS.filter(({ header }) => {
    if (response.headers.get(header)) return false;
    // A CSP frame-ancestors directive is the modern replacement for X-Frame-Options.
    if (header === 'X-Frame-Options' && csp && /frame-ancestors/i.test(csp)) return false;
    return true;
  }).map(({ header, severity, description, recommendation }) => ({
    title: `Missing ${header} header`,
    description,
    severity,
    confidence: Confidence.HIGH,
    category: header === 'Strict-Transport-Security' ? CATEGORY_TRANSPORT : CATEGORY_CONFIG,
    evidence: truncateEvidence(`${header} was absent from the response to ${response.url}`),
    recommendation,
  }));
}

function contentSecurityPolicyFindings(response: SafeResponse): FindingInput[] {
  const csp = response.headers.get('content-security-policy');
  if (!csp) return [];

  const findings: FindingInput[] = [];
  const scriptDirective = /script-src[^;]*/i.exec(csp)?.[0] ?? /default-src[^;]*/i.exec(csp)?.[0] ?? '';

  if (/unsafe-inline/i.test(scriptDirective)) {
    findings.push({
      title: 'Content-Security-Policy allows unsafe-inline script',
      description: 'The script directive permits inline script, which removes most of the cross-site scripting protection a CSP provides.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONFIG,
      evidence: truncateEvidence(`Effective script directive: ${scriptDirective}`),
      recommendation: 'Remove unsafe-inline and adopt nonces or hashes for the inline script you cannot eliminate.',
    });
  }

  if (/unsafe-eval/i.test(scriptDirective)) {
    findings.push({
      title: 'Content-Security-Policy allows unsafe-eval',
      description: 'The script directive permits eval, which lets injected strings become executable code.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONFIG,
      evidence: truncateEvidence(`Effective script directive: ${scriptDirective}`),
      recommendation: 'Remove unsafe-eval and replace runtime code generation with static alternatives.',
    });
  }

  if (/(^|[\s;])(default-src|script-src)\s+[^;]*\*/i.test(csp)) {
    findings.push({
      title: 'Content-Security-Policy uses a wildcard source',
      description: 'A wildcard source lets the page load script from any origin.',
      severity: Severity.MEDIUM,
      confidence: Confidence.MEDIUM,
      category: CATEGORY_CONFIG,
      evidence: truncateEvidence(`Content-Security-Policy: ${csp}`),
      recommendation: 'Replace wildcard sources with the specific origins your application requires.',
    });
  }

  return findings;
}

function strictTransportSecurityFindings(response: SafeResponse): FindingInput[] {
  const hsts = response.headers.get('strict-transport-security');
  if (!hsts) return [];

  const findings: FindingInput[] = [];
  const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] ?? '0');

  if (maxAge < 15_552_000) {
    findings.push({
      title: 'Strict-Transport-Security max-age is too short',
      description: 'A short HSTS lifetime leaves a recurring window in which a downgrade attack can succeed.',
      severity: Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY_TRANSPORT,
      evidence: truncateEvidence(`Strict-Transport-Security: ${hsts} (max-age ${maxAge} seconds)`),
      recommendation: 'Raise max-age to at least 15552000 seconds, which is 180 days.',
    });
  }

  if (!/includeSubDomains/i.test(hsts)) {
    findings.push({
      title: 'Strict-Transport-Security omits includeSubDomains',
      description: 'Subdomains are not covered by the HSTS policy and may still be reachable over plaintext.',
      severity: Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY_TRANSPORT,
      evidence: truncateEvidence(`Strict-Transport-Security: ${hsts}`),
      recommendation: 'Add includeSubDomains once every subdomain is confirmed to serve HTTPS.',
    });
  }

  return findings;
}

function cookieFindings(response: SafeResponse): FindingInput[] {
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (!cookies.length) return [];

  const findings: FindingInput[] = [];

  for (const cookie of cookies) {
    const name = cookie.split('=')[0]?.trim() ?? 'unnamed';
    const missing: string[] = [];
    if (!/;\s*secure/i.test(cookie)) missing.push('Secure');
    if (!/;\s*httponly/i.test(cookie)) missing.push('HttpOnly');
    if (!/;\s*samesite/i.test(cookie)) missing.push('SameSite');
    if (!missing.length) continue;

    findings.push({
      title: `Cookie ${name} missing ${missing.join(', ')}`,
      description: 'A cookie was set without the full complement of protective attributes.',
      severity: missing.includes('Secure') || missing.includes('HttpOnly') ? Severity.MEDIUM : Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY_CONFIG,
      evidence: truncateEvidence(`Set-Cookie: ${cookie.split(';')[0]}=… missing ${missing.join(', ')}`),
      recommendation: 'Set Secure, HttpOnly, and an explicit SameSite value on cookies that carry session state.',
    });
  }

  return findings;
}

function corsFindings(response: SafeResponse): FindingInput[] {
  const allowOrigin = response.headers.get('access-control-allow-origin');
  const allowCredentials = response.headers.get('access-control-allow-credentials');
  if (!allowOrigin) return [];

  if (allowOrigin === '*' && allowCredentials?.toLowerCase() === 'true') {
    return [
      {
        title: 'CORS allows any origin with credentials',
        description: 'A wildcard origin combined with credentialed requests lets any site read authenticated responses.',
        severity: Severity.HIGH,
        confidence: Confidence.HIGH,
        category: CATEGORY_CONFIG,
        evidence: truncateEvidence(`Access-Control-Allow-Origin: ${allowOrigin}; Access-Control-Allow-Credentials: ${allowCredentials}`),
        recommendation: 'Reflect only an explicit allowlist of origins when credentials are permitted.',
      },
    ];
  }

  if (allowOrigin === '*') {
    return [
      {
        title: 'CORS allows any origin',
        description: 'The response permits cross-origin reads from any site.',
        severity: Severity.LOW,
        confidence: Confidence.HIGH,
        category: CATEGORY_CONFIG,
        evidence: truncateEvidence(`Access-Control-Allow-Origin: ${allowOrigin}`),
        recommendation: 'Restrict the allowed origins if this endpoint returns anything non-public.',
      },
    ];
  }

  return [];
}

function disclosureFindings(response: SafeResponse): FindingInput[] {
  const disclosed = DISCLOSURE_HEADERS.map((header) => [header, response.headers.get(header)] as const).filter(
    (entry): entry is readonly [string, string] => Boolean(entry[1]),
  );
  if (!disclosed.length) return [];

  const versioned = disclosed.some(([, value]) => /\d+\.\d+/.test(value));

  return [
    {
      title: 'Server technology disclosed in response headers',
      description: 'Response headers identify the server software, which helps an attacker target known vulnerabilities.',
      severity: versioned ? Severity.LOW : Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY_DISCLOSURE,
      evidence: truncateEvidence(disclosed.map(([header, value]) => `${header}: ${value}`).join('; ')),
      recommendation: 'Remove or minimize headers that identify server software and version numbers.',
    },
  ];
}

async function plaintextRedirectFindings(client: SafeHttpClient, hostname: string): Promise<FindingInput[]> {
  const response = await client.request('/', { scheme: 'http', readBody: false });
  if (!response) return [];

  const location = response.headers.get('location');
  const redirectsToHttps = response.status >= 300 && response.status < 400 && location?.toLowerCase().startsWith('https://');

  if (redirectsToHttps) return [];

  if (response.status >= 300 && response.status < 400) {
    return [
      {
        title: 'Plaintext HTTP redirects to another plaintext location',
        description: 'The HTTP listener redirects without upgrading the connection to HTTPS.',
        severity: Severity.MEDIUM,
        confidence: Confidence.HIGH,
        category: CATEGORY_TRANSPORT,
        evidence: truncateEvidence(`GET http://${hostname}/ returned ${response.status} to ${location ?? 'an unspecified location'}`),
        recommendation: 'Redirect all plaintext traffic straight to the HTTPS equivalent of the requested URL.',
      },
    ];
  }

  return [
    {
      title: 'Content served over plaintext HTTP',
      description: 'The target answered a plaintext HTTP request with content instead of redirecting to HTTPS.',
      severity: Severity.HIGH,
      confidence: Confidence.HIGH,
      category: CATEGORY_TRANSPORT,
      evidence: truncateEvidence(`GET http://${hostname}/ returned ${response.status} without redirecting to HTTPS`),
      recommendation: 'Terminate plaintext HTTP with a 301 redirect to the HTTPS URL and enable HSTS.',
    },
  ];
}
