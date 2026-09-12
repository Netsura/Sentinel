import { Confidence, Severity } from '@prisma/client';
import { promises as dns } from 'node:dns';
import { FindingInput, truncateEvidence } from '../lib/findings';

const CATEGORY = 'DNS';

export async function dnsFindings(hostname: string, addresses: string[], isIp: boolean): Promise<FindingInput[]> {
  const findings: FindingInput[] = [
    {
      title: 'Resolved target addresses',
      description: 'Addresses the scanner authorized and pinned for the duration of this scan.',
      severity: Severity.INFO,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`${hostname} resolved to ${addresses.join(', ')}`),
      recommendation: 'Confirm these addresses match the infrastructure you expect to expose publicly.',
    },
  ];

  if (isIp) return findings;

  const [txtRecords, dmarcRecords, caaRecords, mxRecords] = await Promise.all([
    dns.resolveTxt(hostname).catch(() => [] as string[][]),
    dns.resolveTxt(`_dmarc.${hostname}`).catch(() => [] as string[][]),
    dns.resolveCaa(hostname).catch(() => [] as { issue?: string; issuewild?: string }[]),
    dns.resolveMx(hostname).catch(() => [] as { exchange: string; priority: number }[]),
  ]);

  const flattenedTxt = txtRecords.map((record) => record.join(''));
  const spf = flattenedTxt.find((record) => record.toLowerCase().startsWith('v=spf1'));
  const dmarc = dmarcRecords.map((record) => record.join('')).find((record) => record.toLowerCase().startsWith('v=dmarc1'));

  if (!spf) {
    findings.push({
      title: 'Missing SPF record',
      description: 'No SPF record was published, so receivers cannot tell which hosts may send mail for this domain.',
      severity: mxRecords.length ? Severity.MEDIUM : Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`No v=spf1 TXT record at ${hostname}; ${mxRecords.length} MX record(s) present`),
      recommendation: 'Publish an SPF record listing authorized senders and end it with -all or ~all.',
    });
  } else if (/[+?]all\s*$/i.test(spf)) {
    findings.push({
      title: 'SPF record permits any sender',
      description: 'The SPF record ends in a permissive qualifier, which defeats the purpose of publishing it.',
      severity: Severity.MEDIUM,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`SPF record: ${spf}`),
      recommendation: 'Replace the trailing +all or ?all with -all or ~all.',
    });
  }

  if (!dmarc) {
    findings.push({
      title: 'Missing DMARC policy',
      description: 'No DMARC record was published, so SPF and DKIM failures carry no enforcement instruction.',
      severity: mxRecords.length ? Severity.MEDIUM : Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`No v=DMARC1 TXT record at _dmarc.${hostname}`),
      recommendation: 'Publish a DMARC record and move toward p=reject once reporting looks clean.',
    });
  } else if (/p=none/i.test(dmarc)) {
    findings.push({
      title: 'DMARC policy set to none',
      description: 'DMARC is published in monitoring mode only and does not instruct receivers to act on failures.',
      severity: Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`DMARC record: ${dmarc}`),
      recommendation: 'Progress the policy to p=quarantine and then p=reject after reviewing aggregate reports.',
    });
  }

  if (!caaRecords.length) {
    findings.push({
      title: 'No CAA records published',
      description: 'Without CAA records any certificate authority may issue certificates for this domain.',
      severity: Severity.LOW,
      confidence: Confidence.HIGH,
      category: CATEGORY,
      evidence: truncateEvidence(`No CAA records at ${hostname}`),
      recommendation: 'Publish CAA records naming only the certificate authorities you intend to use.',
    });
  }

  return findings;
}

export async function resolveSubdomain(candidate: string) {
  const [addresses, cname] = await Promise.all([
    dns.resolve4(candidate).catch(() => [] as string[]),
    dns.resolveCname(candidate).catch(() => [] as string[]),
  ]);
  return { candidate, addresses, cname };
}
