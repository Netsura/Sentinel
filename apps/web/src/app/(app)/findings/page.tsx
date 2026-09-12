'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import styles from './page.module.css';

type Finding = { id: string; title: string; description: string; severity: string; confidence: string; status: string; category: string; asset: { value: string } };

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    apiRequest<Finding[]>(`/findings?${new URLSearchParams({ ...(search ? { search } : {}), ...(severity ? { severity } : {}), ...(status ? { status } : {}) })}`, { headers: { 'x-workspace-id': sessionStorage.getItem('sentinel.workspaceId') ?? '' } }).then(setFindings).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load findings'));
  }, [search, severity, status]);

  async function updateStatus(id: string, nextStatus: string) {
    await apiRequest(`/findings/${id}`, { method: 'PATCH', headers: { 'x-workspace-id': sessionStorage.getItem('sentinel.workspaceId') ?? '' }, body: JSON.stringify({ status: nextStatus }) });
    setFindings((current) => current.map((finding) => finding.id === id ? { ...finding, status: nextStatus } : finding));
  }

  return <main className={styles.page}><header><div><p className={styles.eyebrow}>INVESTIGATE</p><h1>Findings</h1><p className={styles.subtitle}>Review evidence and track remediation across your authorized assets.</p></div><a href="/">Back to overview</a></header><section className={styles.toolbar}><input placeholder="Search title, evidence, or description" value={search} onChange={(event) => setSearch(event.target.value)} /><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">All severities</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option><option>INFO</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option>OPEN</option><option>ACKNOWLEDGED</option><option>RESOLVED</option><option>FALSE_POSITIVE</option></select></section>{error ? <p className={styles.error}>{error}</p> : <section className={styles.list}>{findings.map((finding) => <article className={styles.row} key={finding.id}><span className={`${styles.severity} ${styles[finding.severity.toLowerCase()]}`}>{finding.severity}</span><div className={styles.detail}><h2>{finding.title}</h2><p>{finding.asset.value} · {finding.category} · {finding.confidence} confidence</p><small>{finding.description}</small></div><select value={finding.status} onChange={(event) => updateStatus(finding.id, event.target.value)}><option>OPEN</option><option>ACKNOWLEDGED</option><option>RESOLVED</option><option>FALSE_POSITIVE</option></select></article>)}</section>}</main>;
}
