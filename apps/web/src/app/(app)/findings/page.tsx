'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../../components/AppShell';
import { listFindings, updateFindingStatus, type Finding, type FindingStatus } from '../../../lib/api';
import { SEVERITY_ORDER, relativeTime } from '../../../lib/format';
import styles from './page.module.css';

const STATUSES: FindingStatus[] = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'];

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    listFindings({ search, severity, status })
      .then(setFindings)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load findings'));
  }, [search, severity, status]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function changeStatus(finding: Finding, next: FindingStatus) {
    setFindings((current) => current.map((item) => (item.id === finding.id ? { ...item, status: next } : item)));
    try {
      await updateFindingStatus(finding.id, next);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update the finding');
      load();
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="INVESTIGATE"
        title="Findings"
        subtitle="Review evidence and track remediation across your authorized assets."
      />

      <section className={styles.toolbar}>
        <input
          placeholder="Search title, evidence, or description"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search findings"
        />
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter by severity">
          <option value="">All severities</option>
          {SEVERITY_ORDER.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((option) => (
            <option key={option} value={option}>
              {option.replace('_', ' ')}
            </option>
          ))}
        </select>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.list}>
        {findings.length === 0 ? (
          <p className={styles.empty}>No findings match these filters.</p>
        ) : (
          findings.map((finding) => (
            <article className={styles.row} key={finding.id}>
              <div className={styles.summary}>
                <span className={`${styles.severity} ${styles[finding.severity.toLowerCase()]}`}>{finding.severity}</span>
                <div className={styles.detail}>
                  <h2>{finding.title}</h2>
                  <p>
                    {finding.asset.value} · {finding.category} · {finding.confidence} confidence · {relativeTime(finding.lastDetectedAt)}
                  </p>
                </div>
                <button className={styles.expand} onClick={() => setExpanded(expanded === finding.id ? null : finding.id)} aria-expanded={expanded === finding.id}>
                  {expanded === finding.id ? 'Hide' : 'Evidence'}
                </button>
                <select value={finding.status} onChange={(event) => void changeStatus(finding, event.target.value as FindingStatus)} aria-label={`Status for ${finding.title}`}>
                  {STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {option.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              {expanded === finding.id && (
                <dl className={styles.evidence}>
                  <dt>Description</dt>
                  <dd>{finding.description}</dd>
                  <dt>Evidence</dt>
                  <dd>
                    <code>{finding.evidence}</code>
                  </dd>
                  <dt>Recommendation</dt>
                  <dd>{finding.recommendation}</dd>
                </dl>
              )}
            </article>
          ))
        )}
      </section>
    </>
  );
}
