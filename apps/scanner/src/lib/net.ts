import { promises as dns } from 'node:dns';

export const SCANNER_USER_AGENT = 'Sentinel-Scanner/1.0 (authorized security assessment)';

const TEXTUAL_CONTENT = /(text\/|application\/(json|javascript|xml|xhtml|x-javascript)|\+json|\+xml)/i;

export class TargetChangedError extends Error {
  constructor() {
    super('Target DNS changed during the scan; refusing further requests');
  }
}

export class UnroutableTargetError extends Error {
  constructor(hostname: string) {
    super(`Resolved target is not publicly routable: ${hostname}`);
  }
}

export function isPrivateAddress(address: string) {
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first >= 224) return true;
  return false;
}

export function isIpLiteral(value: string) {
  return value.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

export async function resolvePublicAddresses(hostname: string) {
  if (isIpLiteral(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnroutableTargetError(hostname);
    return [hostname];
  }

  const resolved = await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  const addresses = resolved.map(({ address }) => address).sort();
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new UnroutableTargetError(hostname);
  return addresses;
}

export type SafeResponse = {
  url: string;
  path: string;
  method: string;
  status: number;
  headers: Headers;
  body: string;
  bodyTruncated: boolean;
  contentType: string;
  contentLength: number;
};

export type SafeHttpOptions = {
  requestBudget: number;
  minIntervalMs: number;
  timeoutMs: number;
  maxBodyBytes: number;
};

export type SafeRequestInit = {
  method?: string;
  scheme?: 'http' | 'https';
  readBody?: boolean;
};

/**
 * Every outbound request funnels through this client so a single scan cannot
 * exceed its request budget, outpace its rate limit, or follow a redirect onto
 * a host the operator never authorized. Addresses are re-resolved before each
 * request and compared against the set captured at scan start, which closes the
 * DNS-rebinding window between the initial authorization check and the request.
 */
export class SafeHttpClient {
  private requestsUsed = 0;
  private lastRequestAt = 0;
  private budgetExhaustedReported = false;

  constructor(
    private readonly hostname: string,
    private readonly pinnedAddresses: string[],
    private readonly options: SafeHttpOptions,
  ) {}

  get used() {
    return this.requestsUsed;
  }

  get remaining() {
    return Math.max(0, this.options.requestBudget - this.requestsUsed);
  }

  get exhausted() {
    return this.remaining === 0;
  }

  /** Returns null when the request budget is spent or the target refuses the request. */
  async request(path: string, init: SafeRequestInit = {}): Promise<SafeResponse | null> {
    if (this.exhausted) {
      if (!this.budgetExhaustedReported) this.budgetExhaustedReported = true;
      return null;
    }

    await this.throttle();
    await this.assertTargetUnchanged();

    const scheme = init.scheme ?? 'https';
    const method = init.method ?? 'GET';
    const url = `${scheme}://${this.hostname}${path.startsWith('/') ? path : `/${path}`}`;
    this.requestsUsed += 1;
    this.lastRequestAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
        headers: { 'User-Agent': SCANNER_USER_AGENT, Accept: '*/*' },
      });
    } catch {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const shouldRead = (init.readBody ?? true) && method !== 'HEAD' && TEXTUAL_CONTENT.test(contentType);
    const { body, truncated, bytes } = shouldRead
      ? await this.readCappedBody(response)
      : { body: '', truncated: false, bytes: Number(response.headers.get('content-length') ?? 0) };

    if (!shouldRead) await response.body?.cancel().catch(() => undefined);

    return { url, path, method, status: response.status, headers: response.headers, body, bodyTruncated: truncated, contentType, contentLength: bytes };
  }

  private async readCappedBody(response: Response) {
    if (!response.body) return { body: '', truncated: false, bytes: 0 };

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let truncated = false;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        bytes += value.byteLength;
        if (bytes >= this.options.maxBodyBytes) {
          truncated = true;
          break;
        }
      }
    } catch {
      // A truncated or reset body is still usable evidence for the checks below.
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    return { body: Buffer.concat(chunks).toString('utf8').slice(0, this.options.maxBodyBytes), truncated, bytes };
  }

  private async throttle() {
    const waitFor = this.options.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (this.lastRequestAt && waitFor > 0) await delay(waitFor);
  }

  private async assertTargetUnchanged() {
    const current = await resolvePublicAddresses(this.hostname);
    if (current.join('|') !== this.pinnedAddresses.join('|')) throw new TargetChangedError();
  }
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sameHost(candidate: string, hostname: string) {
  try {
    const url = new URL(candidate);
    return url.hostname.toLowerCase() === hostname.toLowerCase();
  } catch {
    return false;
  }
}
