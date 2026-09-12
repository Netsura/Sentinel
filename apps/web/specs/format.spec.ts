import { formatDelta, formatStage, initials, relativeTime, scoreLabel, scoreTone } from '../src/lib/format';

describe('initials', () => {
  it('derives two letters from a structured local part', () => {
    expect(initials('alex.kim@example.com')).toBe('AK');
    expect(initials('jane_doe@example.com')).toBe('JD');
  });

  it('falls back to the first two characters', () => {
    expect(initials('security@example.com')).toBe('SE');
  });
});

describe('relativeTime', () => {
  it('renders a placeholder for missing or invalid values', () => {
    expect(relativeTime(null)).toBe('—');
    expect(relativeTime('not-a-date')).toBe('—');
  });

  it('describes recent timestamps', () => {
    expect(relativeTime(new Date())).toBe('just now');
    expect(relativeTime(new Date(Date.now() - 5 * 60_000))).toBe('5m ago');
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000))).toBe('3h ago');
    expect(relativeTime(new Date(Date.now() - 2 * 86_400_000))).toBe('2d ago');
  });
});

describe('scoreTone and scoreLabel', () => {
  it('maps scores onto posture bands', () => {
    expect(scoreTone(95)).toBe('good');
    expect(scoreTone(70)).toBe('warn');
    expect(scoreTone(20)).toBe('bad');
    expect(scoreTone(null)).toBe('unknown');
  });

  it('labels an unscanned workspace distinctly', () => {
    expect(scoreLabel(null)).toBe('Not yet scanned');
    expect(scoreLabel(90)).toBe('Strong posture');
  });
});

describe('formatStage', () => {
  it('turns scanner stage constants into prose', () => {
    expect(formatStage('SECURITY_CHECKS')).toBe('Security Checks');
    expect(formatStage('DNS')).toBe('Dns');
  });
});

describe('formatDelta', () => {
  it('signs positive deltas and hides zero', () => {
    expect(formatDelta(6)).toBe('+6');
    expect(formatDelta(-4)).toBe('-4');
    expect(formatDelta(0)).toBeNull();
    expect(formatDelta(null)).toBeNull();
  });
});
