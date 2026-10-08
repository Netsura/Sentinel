import http from 'node:http';
import https from 'node:https';
import { promises as dns } from 'node:dns';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';

export const SCANNER_USER_AGENT = 'Sentinel-Scanner/1.0 (authorized security assessment)';

const TEXTUAL_CONTENT = /(text\/|application\/(json|javascript|xml|xhtml|x-javascript)|\+json|\+xml)/i;

export class TargetChangedError extends Error {
  readonly name = 'TargetChangedError';
  constructor() {
    super('Target DNS changed during the scan; refusing further requests');
  }
}

export class UnroutableTargetError extends Error {
  readonly name = 'UnroutableTargetError';
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

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolvePublicAddresses(hostname: string, timeoutMs = 8_000) {
  if (isIpLiteral(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnroutableTargetError(hostname);
    return [hostname];
  }

  const resolved = await withTimeout(
    dns.lookup(hostname, { all: true, verbatim: true }).catch(() => [] as Array<{ address: string }>),
    timeoutMs,
    `DNS lookup timed out for ${hostname}`,
  ).catch(() => [] as Array<{ address: string }>);
  const addresses = resolved.map(({ address }) => address).sort();
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new UnroutableTargetError(hostname);
  return addresses;
}

export function pinnedConnectAddress(addresses: string[]) {
  const publicAddresses = addresses.filter((address) => !isPrivateAddress(address));
  if (!publicAddresses.length) throw new UnroutableTargetError('none');
  return publicAddresses[0];
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
  signal?: AbortSignal;
};

export type SafeRequestInit = {
  method?: string;
  scheme?: 'http' | 'https';
  readBody?: boolean;
};

function hostHeader(hostname: string) {
  return hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}

function toFetchHeaders(raw: IncomingHttpHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (key.toLowerCase() === 'set-cookie') {
      const cookies = Array.isArray(value) ? value : [value];
      for (const cookie of cookies) headers.append('set-cookie', cookie);
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

function isDeadlineError(error: unknown) {
  return error instanceof Error && (error.name === 'ScanDeadlineError' || error.message === 'Scan deadline exceeded');
}

/**
 * Every outbound request funnels through this client so a single scan cannot
 * exceed its request budget, outpace its rate limit, or follow a redirect onto
 * a host the operator never authorized. TCP connects to a pinned public IP with
 * the original hostname used only for Host/SNI, which closes DNS rebinding
 * between authorization and connect. Addresses are re-resolved before and
 * after each request and compared against the set captured at scan start.
 */
export class SafeHttpClient {
  private requestsUsed = 0;
  private lastRequestAt = 0;
  private budgetExhaustedReported = false;
  private readonly connectIp: string;

  constructor(
    private readonly hostname: string,
    private readonly pinnedAddresses: string[],
    private readonly options: SafeHttpOptions,
  ) {
    this.connectIp = pinnedConnectAddress(pinnedAddresses);
  }

  get used() {
    return this.requestsUsed;
  }

  get remaining() {
    return Math.max(0, this.options.requestBudget - this.requestsUsed);
  }

  get exhausted() {
    return this.remaining === 0;
  }

  get pinnedIp() {
    return this.connectIp;
  }

  /** Returns null when the request budget is spent or the target refuses the request. */
  async request(path: string, init: SafeRequestInit = {}): Promise<SafeResponse | null> {
    this.assertNotAborted();
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

    let response: SafeResponse;
    try {
      response = await this.dispatch(url, path.startsWith('/') ? path : `/${path}`, method, scheme, init.readBody ?? true);
    } catch (error) {
      if (error instanceof TargetChangedError || isDeadlineError(error)) throw error;
      return null;
    }

    await this.assertTargetUnchanged();
    return response;
  }

  private dispatch(url: string, path: string, method: string, scheme: 'http' | 'https', readBody: boolean) {
    this.assertNotAborted();
    const lib = scheme === 'https' ? https : http;
    const headers: http.OutgoingHttpHeaders = {
      Host: hostHeader(this.hostname),
      'User-Agent': SCANNER_USER_AGENT,
      Accept: '*/*',
    };

    return new Promise<SafeResponse>((resolve, reject) => {
      const req = lib.request(
        {
          host: this.connectIp,
          family: this.connectIp.includes(':') ? 6 : 4,
          port: scheme === 'https' ? 443 : 80,
          method,
          path,
          setHost: false,
          timeout: this.options.timeoutMs,
          headers,
          ...(scheme === 'https'
            ? {
                servername: isIpLiteral(this.hostname) ? undefined : this.hostname,
                rejectUnauthorized: true,
              }
            : {}),
        },
        async (res) => {
          try {
            const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : '';
            const shouldRead = readBody && method !== 'HEAD' && TEXTUAL_CONTENT.test(contentType);
            const { body, truncated, bytes } = shouldRead
              ? await this.readCappedBody(res)
              : { body: '', truncated: false, bytes: Number(res.headers['content-length'] ?? 0) };
            if (!shouldRead) res.resume();
            resolve({
              url,
              path,
              method,
              status: res.statusCode ?? 0,
              headers: toFetchHeaders(res.headers),
              body,
              bodyTruncated: truncated,
              contentType,
              contentLength: bytes,
            });
          } catch (error) {
            reject(error);
          }
        },
      );

      const onAbort = () => {
        req.destroy();
        reject(Object.assign(new Error('Scan deadline exceeded'), { name: 'ScanDeadlineError' }));
      };
      this.options.signal?.addEventListener('abort', onAbort, { once: true });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timed out after ${this.options.timeoutMs}ms`));
      });
      req.on('error', (error) => reject(error));
      req.end();
    });
  }

  private async readCappedBody(response: IncomingMessage) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;

    try {
      for await (const chunk of response) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
        bytes += buf.byteLength;
        if (bytes >= this.options.maxBodyBytes) {
          truncated = true;
          response.destroy();
          break;
        }
      }
    } catch {
      // A truncated or reset body is still usable evidence for the checks below.
    }

    return { body: Buffer.concat(chunks).toString('utf8').slice(0, this.options.maxBodyBytes), truncated, bytes };
  }

  private async throttle() {
    const waitFor = this.options.minIntervalMs - (Date.now() - this.lastRequestAt);
    if (this.lastRequestAt && waitFor > 0) await delay(waitFor);
  }

  private async assertTargetUnchanged() {
    this.assertNotAborted();
    const current = await resolvePublicAddresses(this.hostname);
    if (current.join('|') !== this.pinnedAddresses.join('|') || !current.includes(this.connectIp)) {
      throw new TargetChangedError();
    }
  }

  private assertNotAborted() {
    if (this.options.signal?.aborted) {
      throw Object.assign(new Error('Scan deadline exceeded'), { name: 'ScanDeadlineError' });
    }
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
