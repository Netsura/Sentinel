'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../../components/AppShell';
import {
  createSchedule,
  deleteSchedule,
  listAssets,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  type Asset,
  type ScanMode,
  type Schedule,
  type ScheduleFrequency,
} from '../../../lib/api';
import { SCAN_MODES } from '../../../lib/format';
import styles from './page.module.css';

const FREQUENCIES: ScheduleFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState('');
  const [mode, setMode] = useState<ScanMode>('SAFE');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('WEEKLY');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [scheduleList, assetList] = await Promise.all([listSchedules(), listAssets()]);
      setSchedules(scheduleList);
      setAssets(assetList);
      if (assetList.length) setAssetId((current) => current || assetList[0].id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load schedules');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await createSchedule(assetId, mode, frequency);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create the schedule');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(schedule: Schedule) {
    setError('');
    try {
      await (schedule.enabled ? pauseSchedule(schedule.id) : resumeSchedule(schedule.id));
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update the schedule');
    }
  }

  async function remove(schedule: Schedule) {
    setError('');
    try {
      await deleteSchedule(schedule.id);
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to delete the schedule');
    }
  }

  const selectedAsset = assets.find((asset) => asset.id === assetId);
  const locked = mode !== 'SAFE' && selectedAsset?.verificationStatus !== 'VERIFIED';

  return (
    <>
      <PageHeader eyebrow="AUTOMATION" title="Scheduled scans" subtitle="Recurring posture checks. Active modes require a verified asset, the same as manual scans." />

      {assets.length === 0 ? (
        <p className={styles.empty}>
          No assets to schedule. <Link href="/assets">Add an asset</Link> first.
        </p>
      ) : (
        <form className={styles.addPanel} onSubmit={add}>
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
          <label>
            Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as ScanMode)}>
              {SCAN_MODES.map((option) => (
                <option key={option.mode} value={option.mode}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Frequency
            <select value={frequency} onChange={(event) => setFrequency(event.target.value as ScheduleFrequency)}>
              {FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || locked}>{busy ? 'Saving…' : 'Add schedule'}</button>
        </form>
      )}

      {locked && assets.length > 0 && (
        <p className={styles.lockNotice}>
          {selectedAsset?.value} is not verified. <Link href="/assets">Verify it</Link> to schedule {mode.toLowerCase()} scans.
        </p>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.list}>
        {schedules.length === 0 ? (
          <p className={styles.empty}>No scheduled scans yet.</p>
        ) : (
          schedules.map((schedule) => (
            <article className={styles.row} key={schedule.id}>
              <div>
                <strong>{schedule.asset.value}</strong>
                <small>
                  {schedule.frequency} · {schedule.mode}
                </small>
              </div>
              <span className={`${styles.state} ${schedule.enabled ? styles.enabled : styles.paused}`}>{schedule.enabled ? 'ACTIVE' : 'PAUSED'}</span>
              <time>{schedule.enabled ? `Next: ${new Date(schedule.nextRunAt).toLocaleString()}` : 'Not scheduled'}</time>
              <div className={styles.actions}>
                <button onClick={() => void toggle(schedule)}>{schedule.enabled ? 'Pause' : 'Resume'}</button>
                <button className={styles.danger} onClick={() => void remove(schedule)}>
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}
