'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/AppShell';
import { useAuth } from '../../components/AuthContext';
import { fetchOverview, type Overview, type Severity } from '../../lib/api';
import { formatDateLabel, formatDelta, relativeTime, scoreLabel, scoreTone } from '../../lib/format';
import styles from './page.module.css';

const DONUT_SEGMENTS: Array<{ severity: Severity; color: string; label: string }> = [
  { severity: 'CRITICAL', color: '#d9584c', label: 'Critical' },
  { severity: 'HIGH', color: '#d99762', label: 'High' },
  { severity: 'MEDIUM', color: '#e6b35e', label: 'Medium' },
  { severity: 'LOW', color: '#60ae91', label: 'Low' },
];

export default function OverviewPage() {
  const { workspace } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchOverview(workspace.id)
        .then((data) => {
          if (active) setOverview(data);
        })
        .catch((requestError) => {
          if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load the overview');
        });
    };
    load();
    const timer = setInterval(load, 20_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspace.id]);

  if (error) {
    return (
      <>
        <PageHeader eyebrow={formatDateLabel()} title="Overview" />
        <p className={styles.error}>{error}</p>
      </>
    );
  }

  if (!overview) {
    return (
      <>
        <PageHeader eyebrow={formatDateLabel()} title="Overview" />
        <p className={styles.empty}>Loading workspace posture…</p>
      </>
    );
  }

  const { score, scoreDelta, assets, findings, activeScans, recentFindings, trend, lastCompletedScan } = overview;
  const delta = formatDelta(scoreDelta);
  const tone = scoreTone(score);

  return (
    <>
      <PageHeader
        eyebrow={formatDateLabel()}
        title="Overview"
        actions={
          <Link className={styles.primaryButton} href="/scans">
            + New scan
          </Link>
        }
      />

      <div className={styles.statusBar}>
        <span className={styles.liveDot} />
        {activeScans > 0 ? `${activeScans} scan${activeScans === 1 ? '' : 's'} in progress` : 'No scans running'}
        <span className={styles.statusDivider} />
        {lastCompletedScan
          ? `Last scan of ${lastCompletedScan.asset.value} completed ${relativeTime(lastCompletedScan.completedAt)}`
          : 'No completed scans yet'}
        <Link className={styles.statusLink} href="/scans">
          View scans
        </Link>
      </div>

      <div className={styles.scoreGrid}>
        <article className={`${styles.panel} ${styles.scorePanel}`}>
          <div className={styles.panelHeading}>
            <span>SECURITY SCORE</span>
          </div>
          <div className={styles.scoreRow}>
            <div className={styles.score}>
              {score ?? '—'}
              <span>/100</span>
            </div>
            {delta && (
              <div className={`${styles.scoreDelta} ${scoreDelta && scoreDelta < 0 ? styles.negative : ''}`}>
                {delta}
                <small>vs 30 days ago</small>
              </div>
            )}
          </div>
          <div className={styles.scoreBar}>
            <span className={styles[tone]} style={{ width: `${score ?? 0}%` }} />
          </div>
          <div className={styles.scoreFooter}>
            <span>{scoreLabel(score)}</span>
            <span>Target: 90</span>
          </div>
        </article>

        <Metric
          label="PROTECTED ASSETS"
          value={assets.total}
          detail={`${assets.verified} verified${assets.addedRecently ? ` · +${assets.addedRecently} this month` : ''}`}
          tone="teal"
          href="/assets"
        />
        <Metric
          label="OPEN FINDINGS"
          value={findings.actionable}
          detail={findings.urgent ? `${findings.urgent} critical or high` : 'None critical or high'}
          tone="coral"
          href="/findings"
        />
        <Metric label="ACTIVE SCANS" value={activeScans} detail={activeScans ? 'Running now' : 'Idle'} tone="yellow" href="/scans" />
      </div>

      <div className={styles.mainGrid}>
        <article className={`${styles.panel} ${styles.chartPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <span>SECURITY SCORE TREND</span>
              <p>Completed scans, last 30 days</p>
            </div>
          </div>
          <TrendChart trend={trend} />
        </article>

        <article className={`${styles.panel} ${styles.breakdown}`}>
          <div className={styles.panelHeading}>
            <span>FINDINGS BY SEVERITY</span>
          </div>
          <SeverityBreakdown counts={findings.bySeverity} total={findings.actionable} />
          <Link className={styles.textButton} href="/findings">
            View all findings →
          </Link>
        </article>
      </div>

      <section className={styles.findingsSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>NEEDS ATTENTION</p>
            <h2>Recent findings</h2>
          </div>
          <Link className={styles.textButton} href="/findings">
            View all findings →
          </Link>
        </div>
        <div className={`${styles.panel} ${styles.findingsTable}`}>
          {recentFindings.length === 0 ? (
            <p className={styles.empty}>No open findings. Run a scan to assess your assets.</p>
          ) : (
            recentFindings.map((finding) => (
              <div className={styles.findingRow} key={finding.id}>
                <span className={`${styles.severity} ${styles[finding.severity.toLowerCase()]}`}>{finding.severity}</span>
                <div className={styles.findingName}>
                  <strong>{finding.title}</strong>
                  <small>
                    {finding.asset.value} · {finding.category}
                  </small>
                </div>
                <span className={styles.findingAge}>{relativeTime(finding.lastDetectedAt)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function Metric({ label, value, detail, tone, href }: { label: string; value: number; detail: string; tone: string; href: string }) {
  return (
    <Link className={`${styles.panel} ${styles.metric}`} href={href}>
      <div className={styles.panelHeading}>
        <span>{label}</span>
        <span className={`${styles.metricDot} ${styles[tone]}`} />
      </div>
      <strong>{String(value).padStart(2, '0')}</strong>
      <small>{detail}</small>
    </Link>
  );
}

function TrendChart({ trend }: { trend: Overview['trend'] }) {
  if (trend.length < 2) {
    return <p className={styles.empty}>At least two completed scans are needed to plot a trend.</p>;
  }

  const width = 600;
  const height = 190;
  const points = trend.map((point, index) => {
    const x = (index / (trend.length - 1)) * width;
    const y = height - (point.score / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = points.join(' ');
  const area = `${line} ${width},${height} 0,${height}`;

  return (
    <>
      <div className={styles.chart}>
        <div className={styles.chartLabels}>
          <span>100</span>
          <span>75</span>
          <span>50</span>
          <span>25</span>
          <span>0</span>
        </div>
        <div className={styles.chartArea}>
          <div className={styles.gridLines} />
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Security score trend">
            <defs>
              <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#e06f4f" stopOpacity=".2" />
                <stop offset="1" stopColor="#e06f4f" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline points={area} fill="url(#trendArea)" stroke="none" />
            <polyline points={line} fill="none" stroke="#e06f4f" strokeWidth="3" />
          </svg>
        </div>
      </div>
      <div className={styles.chartDates}>
        <span>{new Date(trend[0].at).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</span>
        <span>{new Date(trend[trend.length - 1].at).toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}</span>
      </div>
    </>
  );
}

function SeverityBreakdown({ counts, total }: { counts: Record<Severity, number>; total: number }) {
  const segments = DONUT_SEGMENTS.map((segment) => ({ ...segment, count: counts[segment.severity] ?? 0 }));
  const sum = segments.reduce((accumulator, segment) => accumulator + segment.count, 0);

  let cursor = 0;
  const stops = segments
    .filter((segment) => segment.count > 0)
    .map((segment) => {
      const start = (cursor / sum) * 360;
      cursor += segment.count;
      const end = (cursor / sum) * 360;
      return `${segment.color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    });

  const background = stops.length ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#e4e9e4 0deg 360deg)';

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut} style={{ background }}>
        <div>
          <strong>{total}</strong>
          <small>open</small>
        </div>
      </div>
      <div className={styles.legend}>
        {segments.map((segment) => (
          <div className={styles.legendItem} key={segment.severity}>
            <span className={styles.legendDot} style={{ background: segment.color }} />
            <span>{segment.label}</span>
            <strong>{segment.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
