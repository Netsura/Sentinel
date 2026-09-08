'use client';

import { useState } from 'react';
import styles from './page.module.css';

const findings = [
  { title: 'Missing Content-Security-Policy', asset: 'api.sentinel.dev', severity: 'MEDIUM', age: '2h ago' },
  { title: 'Certificate expires in 21 days', asset: 'sentinel.dev', severity: 'LOW', age: '5h ago' },
  { title: 'Publicly exposed admin endpoint', asset: 'staging.sentinel.dev', severity: 'HIGH', age: '1d ago' },
];

export default function Index() {
  const [activeView, setActiveView] = useState('Overview');

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><span className={styles.brandMark}>S</span><span>sentinel</span></div>
        <div className={styles.workspace}><span className={styles.workspaceDot} /> Northstar Security <span className={styles.chevron}>⌄</span></div>
        <nav className={styles.navList} aria-label="Main navigation">
          {['Overview', 'Assets', 'Scans', 'Findings', 'Reports'].map((item) => (
            <button className={`${styles.navItem} ${activeView === item ? styles.activeNav : ''}`} key={item} onClick={() => setActiveView(item)}>
              <span className={styles.navIcon}>{item.slice(0, 1)}</span>{item}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <button className={styles.navItem}><span className={styles.navIcon}>?</span>Documentation</button>
          <button className={styles.navItem}><span className={styles.navIcon}>S</span>Settings</button>
          <div className={styles.profile}><span className={styles.avatar}>AK</span><span><strong>Alex Kim</strong><small>Owner</small></span><span className={styles.more}>...</span></div>
        </div>
      </aside>

      <section className={styles.content}>
        <header className={styles.header}><div><p className={styles.eyebrow}>MONDAY, SEPTEMBER 7, 2026</p><h1>{activeView}</h1></div><div className={styles.headerActions}><button className={styles.iconButton}>N</button><button className={styles.primaryButton}>+ New scan</button></div></header>
        <div className={styles.statusBar}><span className={styles.liveDot} /> All systems operational <span className={styles.statusDivider} /> Last scan completed 18 minutes ago <span className={styles.statusLink}>View scan</span></div>

        <div className={styles.scoreGrid}>
          <article className={`${styles.panel} ${styles.scorePanel}`}><div className={styles.panelHeading}><span>SECURITY SCORE</span><button className={styles.kebab}>...</button></div><div className={styles.scoreRow}><div className={styles.score}>82<span>/100</span></div><div className={styles.scoreDelta}>+6.4%<small>vs last scan</small></div></div><div className={styles.scoreBar}><span /></div><div className={styles.scoreFooter}><span>Good posture</span><span>Target: 90</span></div></article>
          <Metric label="PROTECTED ASSETS" value="12" detail="+2 this month" tone="teal" />
          <Metric label="OPEN FINDINGS" value="31" detail="3 critical or high" tone="coral" />
          <Metric label="ACTIVE SCANS" value="01" detail="Running now" tone="yellow" />
        </div>

        <div className={styles.mainGrid}><article className={`${styles.panel} ${styles.chartPanel}`}><div className={styles.panelHeading}><div><span>SECURITY SCORE TREND</span><p>Last 30 days</p></div><select aria-label="Chart range"><option>30 days</option><option>90 days</option></select></div><div className={styles.chart}><div className={styles.chartLabels}><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className={styles.chartArea}><div className={styles.gridLines} /><svg viewBox="0 0 600 190" preserveAspectRatio="none" aria-label="Security score trend"><polyline points="0,128 45,130 90,116 135,120 180,99 225,108 270,78 315,86 360,65 405,71 450,55 495,62 540,40 600,45" fill="none" stroke="#e06f4f" strokeWidth="3" /><polyline points="0,128 45,130 90,116 135,120 180,99 225,108 270,78 315,86 360,65 405,71 450,55 495,62 540,40 600,45 600,190 0,190" fill="url(#area)" stroke="none" /><defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#e06f4f" stopOpacity=".2" /><stop offset="1" stopColor="#e06f4f" stopOpacity="0" /></linearGradient></defs></svg></div></div><div className={styles.chartDates}><span>Aug 08</span><span>Aug 15</span><span>Aug 22</span><span>Aug 29</span><span>Sep 07</span></div></article>
          <article className={`${styles.panel} ${styles.breakdown}`}><div className={styles.panelHeading}><span>FINDINGS BY SEVERITY</span><button className={styles.kebab}>...</button></div><div className={styles.donutWrap}><div className={styles.donut}><div><strong>31</strong><small>total</small></div></div><div className={styles.legend}><Legend color="critical" label="Critical" value="1" /><Legend color="high" label="High" value="2" /><Legend color="medium" label="Medium" value="14" /><Legend color="low" label="Low" value="14" /></div></div><button className={styles.textButton}>View all findings →</button></article></div>

        <section className={styles.findingsSection}><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>NEEDS ATTENTION</p><h2>Recent findings</h2></div><button className={styles.textButton}>View all findings →</button></div><div className={`${styles.panel} ${styles.findingsTable}`}>{findings.map((finding) => <div className={styles.findingRow} key={finding.title}><span className={`${styles.severity} ${styles[finding.severity.toLowerCase()]}`}>{finding.severity}</span><div className={styles.findingName}><strong>{finding.title}</strong><small>{finding.asset}</small></div><span className={styles.findingAge}>{finding.age}</span><button className={styles.rowArrow}>→</button></div>)}</div></section>
      </section>
    </main>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className={`${styles.panel} ${styles.metric}`}><div className={styles.panelHeading}><span>{label}</span><span className={`${styles.metricDot} ${styles[tone]}`} /></div><strong>{value}</strong><small>{detail}</small></article>;
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return <div className={styles.legendItem}><span className={`${styles.legendDot} ${styles[color]}`} /><span>{label}</span><strong>{value}</strong></div>;
}
