'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import styles from './page.module.css';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

type Report = { id: string; scanId: string; format: string; createdAt: string };

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { apiRequest<Report[]>('/reports', { headers: { 'x-workspace-id': sessionStorage.getItem('sentinel.workspaceId') ?? '' } }).then(setReports).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load reports')); }, []);
  return <main className={styles.page}><header><div><p className={styles.eyebrow}>EVIDENCE</p><h1>Reports</h1><p>Professional exports generated from completed scans.</p></div><a href="/">Back to overview</a></header>{error ? <p className={styles.error}>{error}</p> : <section className={styles.list}>{reports.length === 0 ? <p className={styles.empty}>No reports generated yet.</p> : reports.map((report) => <article className={styles.row} key={report.id}><div><strong>{report.format} security report</strong><small>Scan {report.scanId}</small></div><time>{new Date(report.createdAt).toLocaleString()}</time><a href={`${apiBaseUrl}/reports/${report.id}`}>Open</a></article>)}</section>}</main>;
}
