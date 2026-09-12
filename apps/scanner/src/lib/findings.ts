import { Confidence, Severity } from '@prisma/client';

export type FindingInput = {
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  category: string;
  evidence: string;
  recommendation: string;
};

/**
 * Penalties are expressed directly in score points so the deterministic score
 * stays readable. Repeated findings at the same severity decay because twenty
 * missing headers is not twenty times worse than one.
 */
const SEVERITY_PENALTY: Record<Severity, number> = {
  CRITICAL: 30,
  HIGH: 18,
  MEDIUM: 8,
  LOW: 3,
  INFO: 0,
};

const DECAY = [1, 0.6, 0.4, 0.25, 0.15];
const RESIDUAL_DECAY = 0.1;

export function scoreFindings(findings: FindingInput[]) {
  const countsBySeverity = new Map<Severity, number>();
  for (const finding of findings) {
    countsBySeverity.set(finding.severity, (countsBySeverity.get(finding.severity) ?? 0) + 1);
  }

  let penalty = 0;
  for (const [severity, count] of countsBySeverity) {
    for (let index = 0; index < count; index += 1) {
      penalty += SEVERITY_PENALTY[severity] * (DECAY[index] ?? RESIDUAL_DECAY);
    }
  }

  return Math.max(0, Math.min(100, Math.round(100 - penalty)));
}

export function dedupeFindings(findings: FindingInput[]) {
  const ranked = new Map<string, FindingInput>();
  const order: string[] = [];

  for (const finding of findings) {
    const key = `${finding.category}:${finding.title}`;
    const existing = ranked.get(key);
    if (!existing) {
      ranked.set(key, finding);
      order.push(key);
      continue;
    }
    if (SEVERITY_PENALTY[finding.severity] > SEVERITY_PENALTY[existing.severity]) ranked.set(key, finding);
  }

  return order.flatMap((key) => {
    const finding = ranked.get(key);
    return finding ? [finding] : [];
  });
}

export function truncateEvidence(value: string, limit = 600) {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…`;
}
