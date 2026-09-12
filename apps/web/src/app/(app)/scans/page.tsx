'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../../components/AppShell';
import {
  cancelScan,
  createReport,
  diffScans,
  listAssets,
  listScans,
  startScan,
  type Asset,
  type Scan,
  type ScanDiff,
  type ScanMode,
} from '../../../lib/api';
import { SCAN_MODES, formatStage, relativeTime } from '../../../lib/format';
import { useScanProgress } from '../../../lib/useScanProgress';
import styles from './page.module.css';

const ACTIVE_STATUSES: Scan['status'][] = ['QUEUED', 'RUNNING'];

function ScansView() {
  const searchParams = useSearchParams();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [assetId, setAssetId] = useState('');
  const [mode, setMode] = useState<ScanMode>('SAFE');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [assetList, scanList] = await Promise.all([listAssets(), listScans()]);
      setAssets(assetList);
      setScans(scanList);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load scans');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Preselect the asset when arriving from the assets page.
  useEffect(() => {
    const requested = searchParams.get('asset');
    if (requested) setAssetId(requested);
  }, [searchParams]);

  useEffect(() => {
    if (!assetId && assets.length) setAssetId(assets[0].id);
  }, [assetId, assets]);

  const activeScans = useMemo(() => scans.filter((scan) => ACTIVE_STATUSES.includes(scan.status)), [scans]);
  const progress = useScanProgress(activeScans.map((scan) => scan.id));

  // Poll while work is in flight so terminal states land even if the socket drops.
  useEffect(() => {
    if (!activeScans.length) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [activeScans.length, load]);

  const selectedAsset = assets.find((asset) => asset.id === assetId);
  const assetVerified = selectedAsset?.verificationStatus === 'VERIFIED';
  const modeLocked = mode !== 'SAFE' && !assetVerified;

  async function launch() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await startScan(assetId, mode);
      setNotice(`${mode} scan queued for ${selectedAsset?.value ?? 'the asset'}.`);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to start the scan');
    } finally {
      setBusy(false);
    }
  }

  async function stop(scan: Scan) {
    setError('');
    try {
      await cancelScan(scan.id);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to cancel the scan');
    }
  }

  async function generateReport(scan: Scan) {
    setError('');
    setNotice('');
    try {
      await createReport(scan.id, 'JSON');
      setNotice('Report generated. Open the Reports page to download it.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to generate the report');
    }
  }

  const assetName = (id: string) => assets.find((asset) => asset.id === id)?.value ?? 'unknown asset';

  return (
    <>
      <PageHeader
        eyebrow="ASSESS"
        title="Scans"
        subtitle="Safe mode is passive and always available. Normal and aggressive modes send active requests and require a verified asset."
      />

      {assets.length === 0 ? (
        <p className={styles.empty}>
          No assets to scan yet. <Link href="/assets">Add an asset</Link> to get started.
        </p>
      ) : (
        <section className={styles.launcher}>
          <div className={styles.launcherTop}>
            <label>
              Asset
              <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.value} {asset.verificationStatus === 'VERIFIED' ? '' : '(unverified)'}
                  </option>
                ))}
              </select>
            </label>
            <button className={styles.launch} onClick={() => void launch()} disabled={busy || !assetId || modeLocked}>
              {busy ? 'Queueing…' : 'Start scan'}
            </button>
          </div>

          <div className={styles.modeGrid}>
            {SCAN_MODES.map((option) => {
              const locked = option.mode !== 'SAFE' && !assetVerified;
              return (
                <button
                  className={`${styles.modeCard} ${mode === option.mode ? styles.modeActive : ''} ${locked ? styles.modeLocked : ''}`}
                  key={option.mode}
                  onClick={() => setMode(option.mode)}
                  aria-pressed={mode === option.mode}
                >
                  <strong>{option.label}</strong>
                  <small>{option.detail}</small>
                  {locked && <span className={styles.lockBadge}>Requires verification</span>}
                </button>
              );
            })}
          </div>

          {modeLocked && (
            <p className={styles.lockNotice}>
              {selectedAsset?.value} is not verified yet. <Link href="/assets">Complete DNS verification</Link> to unlock {mode.toLowerCase()} mode.
            </p>
          )}
        </section>
      )}

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <section className={styles.history}>
        <h2>Scan history</h2>
        {scans.length === 0 ? (
          <p className={styles.empty}>No scans have run in this workspace yet.</p>
        ) : (
          <div className={styles.table}>
            {scans.map((scan) => {
              const live = progress[scan.id];
              const stage = live?.stage ?? scan.stage;
              const percent = live?.progress ?? scan.progress;
              const running = ACTIVE_STATUSES.includes(scan.status);

              return (
                <article className={styles.scanRow} key={scan.id}>
                  <div className={styles.scanIdentity}>
                    <strong>{assetName(scan.assetId)}</strong>
                    <small>
                      {scan.mode} · queued {relativeTime(scan.queuedAt)}
                    </small>
                  </div>

                  <span className={`${styles.badge} ${styles[scan.status.toLowerCase()]}`}>{scan.status}</span>

                  <div className={styles.progressCell}>
                    {running ? (
                      <>
                        <div className={styles.progressBar}>
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <small>
                          {formatStage(stage)} · {percent}%
                        </small>
                      </>
                    ) : (
                      <small>{formatStage(stage)}</small>
                    )}
                  </div>

                  <span className={styles.scanScore}>
                    {scan.score === null ? '—' : scan.score}
                    <small>score</small>
                  </span>

                  <div className={styles.scanActions}>
                    {running && (
                      <button className={styles.ghost} onClick={() => void stop(scan)}>
                        Cancel
                      </button>
                    )}
                    {scan.status === 'COMPLETED' && (
                      <button className={styles.ghost} onClick={() => void generateReport(scan)}>
                        Report
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <CompareScans scans={scans} assetName={assetName} />
    </>
  );
}

function CompareScans({ scans, assetName }: { scans: Scan[]; assetName: (id: string) => string }) {
  const completed = useMemo(() => scans.filter((scan) => scan.status === 'COMPLETED'), [scans]);
  const [previous, setPrevious] = useState('');
  const [current, setCurrent] = useState('');
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [error, setError] = useState('');

  if (completed.length < 2) return null;

  async function compare() {
    setError('');
    setDiff(null);
    try {
      setDiff(await diffScans(previous || completed[1].id, current || completed[0].id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to compare the scans');
    }
  }

  const label = (scan: Scan) => `${assetName(scan.assetId)} · ${scan.mode} · ${relativeTime(scan.completedAt)}`;

  return (
    <section className={styles.compare}>
      <h2>Compare scans</h2>
      <p className={styles.compareIntro}>See which findings appeared, were resolved, or changed between two completed scans.</p>
      <div className={styles.compareControls}>
        <label>
          Baseline
          <select value={previous || completed[1].id} onChange={(event) => setPrevious(event.target.value)}>
            {completed.map((scan) => (
              <option key={scan.id} value={scan.id}>
                {label(scan)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compared to
          <select value={current || completed[0].id} onChange={(event) => setCurrent(event.target.value)}>
            {completed.map((scan) => (
              <option key={scan.id} value={scan.id}>
                {label(scan)}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.ghost} onClick={() => void compare()}>
          Compare
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {diff && (
        <div className={styles.diffGrid}>
          <DiffCard label="New" count={diff.newFindings.length} tone="bad" />
          <DiffCard label="Resolved" count={diff.resolvedFindings.length} tone="good" />
          <DiffCard label="Changed" count={diff.changedFindings.length} tone="warn" />
          <DiffCard label="Persistent" count={diff.persistentFindings.length} tone="neutral" />
          <DiffCard
            label="Score"
            count={diff.currentScore ?? 0}
            tone={(diff.currentScore ?? 0) >= (diff.previousScore ?? 0) ? 'good' : 'bad'}
            detail={`from ${diff.previousScore ?? '—'}`}
          />
        </div>
      )}
    </section>
  );
}

function DiffCard({ label, count, tone, detail }: { label: string; count: number; tone: string; detail?: string }) {
  return (
    <div className={`${styles.diffCard} ${styles[tone]}`}>
      <strong>{count}</strong>
      <span>{label}</span>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export default function ScansPage() {
  return (
    <Suspense>
      <ScansView />
    </Suspense>
  );
}
