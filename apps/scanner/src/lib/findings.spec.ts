import { Confidence, Severity } from '@prisma/client';
import { dedupeFindings, FindingInput, scoreFindings, truncateEvidence } from './findings';

function finding(severity: Severity, overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    title: 'Example finding',
    description: 'description',
    severity,
    confidence: Confidence.HIGH,
    category: 'Example',
    evidence: 'evidence',
    recommendation: 'recommendation',
    ...overrides,
  };
}

describe('scoreFindings', () => {
  it('returns a perfect score with no findings', () => {
    expect(scoreFindings([])).toBe(100);
  });

  it('ignores informational findings', () => {
    expect(scoreFindings([finding(Severity.INFO), finding(Severity.INFO, { title: 'Another' })])).toBe(100);
  });

  it('penalises higher severities more heavily', () => {
    expect(scoreFindings([finding(Severity.CRITICAL)])).toBeLessThan(scoreFindings([finding(Severity.HIGH)]));
    expect(scoreFindings([finding(Severity.HIGH)])).toBeLessThan(scoreFindings([finding(Severity.MEDIUM)]));
    expect(scoreFindings([finding(Severity.MEDIUM)])).toBeLessThan(scoreFindings([finding(Severity.LOW)]));
  });

  it('decays repeated findings at the same severity', () => {
    const single = 100 - scoreFindings([finding(Severity.MEDIUM)]);
    const double = 100 - scoreFindings([finding(Severity.MEDIUM), finding(Severity.MEDIUM, { title: 'Second' })]);
    expect(double).toBeGreaterThan(single);
    expect(double).toBeLessThan(single * 2);
  });

  it('is independent of finding order', () => {
    const findings = [finding(Severity.LOW), finding(Severity.CRITICAL, { title: 'C' }), finding(Severity.MEDIUM, { title: 'M' })];
    expect(scoreFindings(findings)).toBe(scoreFindings([...findings].reverse()));
  });

  it('never falls below zero regardless of finding volume', () => {
    const many = Array.from({ length: 200 }, (_, index) => finding(Severity.CRITICAL, { title: `Finding ${index}` }));
    expect(scoreFindings(many)).toBe(0);
  });

  it('stays within the 0 to 100 range', () => {
    const mixed = [finding(Severity.CRITICAL), finding(Severity.HIGH, { title: 'H' }), finding(Severity.LOW, { title: 'L' })];
    const score = scoreFindings(mixed);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('dedupeFindings', () => {
  it('collapses duplicates sharing a category and title, keeping the highest severity', () => {
    const result = dedupeFindings([
      finding(Severity.LOW, { title: 'Missing header', category: 'HTTP' }),
      finding(Severity.HIGH, { title: 'Missing header', category: 'HTTP' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(Severity.HIGH);
  });

  it('keeps findings that differ by category', () => {
    const result = dedupeFindings([
      finding(Severity.LOW, { title: 'Same title', category: 'HTTP' }),
      finding(Severity.LOW, { title: 'Same title', category: 'TLS' }),
    ]);

    expect(result).toHaveLength(2);
  });

  it('preserves first-seen ordering', () => {
    const result = dedupeFindings([
      finding(Severity.LOW, { title: 'First' }),
      finding(Severity.LOW, { title: 'Second' }),
      finding(Severity.HIGH, { title: 'First' }),
    ]);

    expect(result.map((item) => item.title)).toEqual(['First', 'Second']);
  });
});

describe('truncateEvidence', () => {
  it('collapses whitespace', () => {
    expect(truncateEvidence('a\n\n  b\tc')).toBe('a b c');
  });

  it('truncates beyond the limit', () => {
    expect(truncateEvidence('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`);
  });

  it('leaves short values untouched', () => {
    expect(truncateEvidence('short', 10)).toBe('short');
  });
});
