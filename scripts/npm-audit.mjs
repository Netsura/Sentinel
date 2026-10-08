#!/usr/bin/env node
/**
 * Fails CI on high/critical advisories except those with no patched release.
 * `npm audit --audit-level=high` cannot ignore a single GHSA, and braces
 * (GHSA-vfj7-8cjw-p6xm) currently has no published fix. Dependents of that
 * advisory (micromatch, fast-glob, eslint-config-next) are also ignored.
 */
import { spawnSync } from 'node:child_process';

const ALLOWED = new Set([
  'GHSA-vfj7-8cjw-p6xm', // braces: no patched npm version yet
]);

const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
let report;
try {
  report = JSON.parse(result.stdout || '{}');
} catch {
  console.error(result.stdout || result.stderr || 'npm audit produced no JSON');
  process.exit(1);
}

const vulns = report.vulnerabilities ?? {};

function advisoryId(item) {
  if (typeof item !== 'object' || !item || typeof item.url !== 'string') return null;
  return item.url.match(/GHSA-[\w-]+/)?.[0] ?? null;
}

function isAllowed(name, seen = new Set()) {
  if (seen.has(name)) return true;
  seen.add(name);
  const entry = vulns[name];
  if (!entry) return true;
  if (entry.severity !== 'high' && entry.severity !== 'critical') return true;
  for (const item of entry.via ?? []) {
    if (typeof item === 'string') {
      if (!isAllowed(item, seen)) return false;
      continue;
    }
    const id = advisoryId(item);
    if (id) {
      if (!ALLOWED.has(id)) return false;
      continue;
    }
    if (item?.severity === 'high' || item?.severity === 'critical') return false;
  }
  return true;
}

const blocking = Object.keys(vulns).filter((name) => !isAllowed(name));

if (!blocking.length) {
  console.log('npm audit: no blocking high/critical advisories (unpatched braces allowlisted)');
  process.exit(0);
}

for (const name of blocking) {
  const entry = vulns[name];
  const ids = (entry.via ?? []).map((item) => (typeof item === 'string' ? item : advisoryId(item) || item.title || 'unknown')).join(', ');
  console.error(`${entry.severity} ${name} (${ids})`);
}
process.exit(1);
