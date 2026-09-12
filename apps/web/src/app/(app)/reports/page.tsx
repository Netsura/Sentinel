'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../../components/AppShell';
import { downloadReport, listReports, type ReportSummary } from '../../../lib/api';
import { relativeTime } from '../../../lib/format';
import styles from './page.module.css';

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(() => {
    listReports()
      .then(setReports)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load reports'));
  }, []);

  useEffect(load, [load]);

  async function download(report: ReportSummary) {
    setError('');
    setDownloading(report.id);
    try {
      await downloadReport(report);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to download the report');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      <PageHeader eyebrow="EVIDENCE" title="Reports" subtitle="Exports generated from completed scans, downloadable as JSON or CSV." />

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.list}>
        {reports.length === 0 ? (
          <p className={styles.empty}>
            No reports generated yet. Complete a scan on the <Link href="/scans">Scans</Link> page, then generate a report from it.
          </p>
        ) : (
          reports.map((report) => (
            <article className={styles.row} key={report.id}>
              <div>
                <strong>{report.format} security report</strong>
                <small>Scan {report.scanId}</small>
              </div>
              <time>{relativeTime(report.createdAt)}</time>
              <button onClick={() => void download(report)} disabled={downloading === report.id}>
                {downloading === report.id ? 'Preparing…' : 'Download'}
              </button>
            </article>
          ))
        )}
      </section>
    </>
  );
}
