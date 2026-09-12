import { Confidence, Severity } from '@prisma/client';
import tls from 'node:tls';
import { FindingInput, truncateEvidence } from '../lib/findings';
import { isIpLiteral } from '../lib/net';

const CATEGORY = 'TLS';
const WEAK_CIPHER = /(RC4|3DES|DES-CBC|NULL|EXPORT|MD5|anon)/i;
const LEGACY_PROTOCOLS = ['TLSv1', 'TLSv1.1'] as const;

type Handshake = {
  certificate: tls.PeerCertificate;
  protocol: string | null;
  cipher: tls.CipherNameAndProtocol | null;
  authorizationError: string | null;
};

function connect(hostname: string, options: tls.ConnectionOptions, timeoutMs: number) {
  return new Promise<Handshake>((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        // SNI must be omitted for IP literals; sending one is invalid.
        ...(isIpLiteral(hostname) ? {} : { servername: hostname }),
        timeout: timeoutMs,
        ...options,
      },
      () => {
        const handshake: Handshake = {
          certificate: socket.getPeerCertificate(true),
          protocol: socket.getProtocol(),
          cipher: socket.getCipher(),
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        };
        socket.end();
        resolve(handshake);
      },
    );

    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('TLS handshake timed out'));
    });
  });
}

export async function tlsFindings(hostname: string, timeoutMs: number, probeLegacyProtocols: boolean): Promise<FindingInput[]> {
  let handshake: Handshake;
  try {
    handshake = await connect(hostname, { rejectUnauthorized: false }, timeoutMs);
  } catch (error) {
    return [
      {
        title: 'TLS handshake failed',
        description: 'The target did not complete a TLS handshake on port 443.',
        severity: Severity.HIGH,
        confidence: Confidence.HIGH,
        category: CATEGORY,
        evidence: truncateEvidence(error instanceof Error ? error.message : 'TLS handshake failed'),
        recommendation: 'Serve a valid certificate over TLS on port 443 and confirm the port is reachable.',
      },
    ];
  }

  const findings: FindingInput[] = [];
  const { certificate, protocol, cipher, authorizationError } = handshake;

  findings.push(...certificateFindings(hostname, certificate, authorizationError));
  findings.push(...protocolFindings(protocol, cipher));

  if (probeLegacyProtocols) findings.push(...(await legacyProtocolFindings(hostname, timeoutMs)));

  return findings;
}

function certificateFindings(hostname: string, certificate: tls.PeerCertificate, authorizationError: string | null): FindingInput[] {
  if (!certificate || !certificate.valid_to) {
    return [
      {
        title: 'TLS certificate unavailable',
        description: 'The handshake completed but the peer presented no usable certificate metadata.',
        severity: Severity.HIGH,
        confidence: Confidence.MEDIUM,
        category: CATEGORY,
        evidence: 'Peer certificate metadata was empty',
        recommendation: 'Install a valid certificate covering the target hostname and serve the full chain.',
      },
    ];
  }

  const findings: FindingInput[] = [];
  const issuer = certificate.issuer?.O ?? certificate.issuer?.CN ?? 'unknown issuer';
  const expiry = new Date(certificate.valid_to);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);

  if (daysUntilExpiry < 0) {
    findings.push({
      title: 'TLS certificate has expired',
      description: 'The certificate presented by the target is past its expiry date.',
      severity: Severity.CRITICAL,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Certificate from ${issuer} expired on ${certificate.valid_to}`),
      recommendation: 'Renew the certificate immediately and automate renewal to prevent recurrence.',
    });
  } else if (daysUntilExpiry <= 30) {
    findings.push({
      title: 'TLS certificate expires soon',
      description: 'The certificate expires within 30 days.',
      severity: daysUntilExpiry <= 7 ? Severity.HIGH : Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Certificate from ${issuer} expires on ${certificate.valid_to} (${daysUntilExpiry} days); SAN: ${certificate.subjectaltname ?? 'unavailable'}`),
      recommendation: 'Renew the certificate before expiration and verify the complete chain is served.',
    });
  }

  if (authorizationError) {
    findings.push({
      title: 'TLS certificate is not trusted',
      description: 'The certificate chain failed validation against the public trust store.',
      severity: Severity.HIGH,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Validation error: ${authorizationError}; issuer: ${issuer}`),
      recommendation: 'Serve a certificate issued by a publicly trusted authority together with all intermediate certificates.',
    });
  }

  if (!isIpLiteral(hostname)) {
    const identityError = tls.checkServerIdentity(hostname, certificate);
    if (identityError) {
      findings.push({
        title: 'TLS certificate hostname mismatch',
        description: 'The certificate does not cover the hostname that was requested.',
        severity: Severity.HIGH,
        confidence: Confidence.HIGH,
        category: CATEGORY,
        evidence: truncateEvidence(`${identityError.message}; CN: ${certificate.subject?.CN ?? 'none'}; SAN: ${certificate.subjectaltname ?? 'none'}`),
        recommendation: 'Reissue the certificate with a subject alternative name covering this hostname.',
      });
    }
  }

  if (certificate.bits && certificate.bits < 2048 && !certificate.asn1Curve && !certificate.nistCurve) {
    findings.push({
      title: 'Weak TLS certificate key length',
      description: 'The certificate uses an RSA key shorter than the 2048-bit minimum.',
      severity: Severity.HIGH,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Public key length: ${certificate.bits} bits`),
      recommendation: 'Reissue the certificate with at least a 2048-bit RSA key or an elliptic curve key.',
    });
  }

  return findings;
}

function protocolFindings(protocol: string | null, cipher: tls.CipherNameAndProtocol | null): FindingInput[] {
  const findings: FindingInput[] = [];

  if (protocol) {
    findings.push({
      title: 'Negotiated TLS protocol and cipher',
      description: 'The protocol and cipher suite selected during the scan handshake.',
      severity: Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Protocol: ${protocol}; cipher: ${cipher?.name ?? 'unknown'}`),
      recommendation: 'Prefer TLS 1.3 where your client population allows it.',
    });
  }

  if (protocol && (LEGACY_PROTOCOLS as readonly string[]).includes(protocol)) {
    findings.push({
      title: 'Deprecated TLS protocol negotiated by default',
      description: 'The target selected a deprecated TLS version without being asked to downgrade.',
      severity: Severity.HIGH,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Default negotiated protocol: ${protocol}`),
      recommendation: 'Disable TLS 1.0 and TLS 1.1 and require TLS 1.2 or newer.',
    });
  }

  if (cipher?.name && WEAK_CIPHER.test(cipher.name)) {
    findings.push({
      title: 'Weak TLS cipher suite negotiated',
      description: 'The negotiated cipher suite relies on a primitive that is no longer considered safe.',
      severity: Severity.HIGH,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Negotiated cipher: ${cipher.name} (${cipher.version})`),
      recommendation: 'Restrict the cipher list to modern AEAD suites such as AES-GCM or ChaCha20-Poly1305.',
    });
  }

  return findings;
}

async function legacyProtocolFindings(hostname: string, timeoutMs: number): Promise<FindingInput[]> {
  const supported: string[] = [];

  for (const protocol of LEGACY_PROTOCOLS) {
    try {
      const result = await connect(hostname, { rejectUnauthorized: false, minVersion: protocol, maxVersion: protocol }, timeoutMs);
      if (result.protocol === protocol) supported.push(protocol);
    } catch {
      // A refused handshake is the desired outcome: the legacy version is disabled.
    }
  }

  if (!supported.length) return [];

  return [
    {
      title: 'Legacy TLS protocol still enabled',
      description: 'The target accepted a handshake using a deprecated TLS version when explicitly offered one.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`Accepted deprecated protocol version(s): ${supported.join(', ')}`),
      recommendation: 'Set the minimum TLS version to 1.2 so downgrade attempts are rejected.',
    },
  ];
}
