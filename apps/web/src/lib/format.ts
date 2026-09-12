export function initials(email: string) {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._\s-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return local.slice(0, 2).toUpperCase() || 'S';
}

export function relativeTime(value?: string | Date | null) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const delta = Date.now() - date.getTime();
  const minutes = Math.round(delta / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ago`;
}

export function formatDateLabel(value = new Date()) {
  return value.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

export const SCAN_MODES = [
  { mode: 'SAFE', label: 'Safe', detail: 'Passive DNS, TLS, and header review. No crawling.' },
  { mode: 'NORMAL', label: 'Normal', detail: 'Adds a bounded crawl, endpoint discovery, and common artifact probes.' },
  { mode: 'AGGRESSIVE', label: 'Aggressive', detail: 'Adds deep crawling, extended probes, and subdomain enumeration. Requires a verified asset.' },
] as const;

export function scoreTone(score: number | null) {
  if (score === null) return 'unknown';
  if (score >= 85) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

export function scoreLabel(score: number | null) {
  if (score === null) return 'Not yet scanned';
  if (score >= 85) return 'Strong posture';
  if (score >= 60) return 'Needs attention';
  return 'At risk';
}

export function formatStage(stage: string) {
  return stage
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatDelta(delta: number | null) {
  if (delta === null || delta === 0) return null;
  return `${delta > 0 ? '+' : ''}${delta}`;
}
