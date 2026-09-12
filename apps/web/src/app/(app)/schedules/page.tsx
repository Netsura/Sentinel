'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import styles from './page.module.css';

type Schedule = { id: string; mode: string; frequency: string; enabled: boolean; nextRunAt: string; asset: { value: string } };

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState('');
  const workspaceHeaders = { 'x-workspace-id': typeof window === 'undefined' ? '' : sessionStorage.getItem('sentinel.workspaceId') ?? '' };
  function load() { apiRequest<Schedule[]>('/schedules', { headers: workspaceHeaders }).then(setSchedules).catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load schedules')); }
  useEffect(load, []);
  async function toggle(schedule: Schedule) { await apiRequest(`/schedules/${schedule.id}/${schedule.enabled ? 'pause' : 'resume'}`, { method: 'PATCH', headers: workspaceHeaders }); load(); }
  return <main className={styles.page}><header><div><p className={styles.eyebrow}>AUTOMATION</p><h1>Scheduled scans</h1><p>Recurring posture checks for verified assets.</p></div><a href="/">Back to overview</a></header>{error ? <p className={styles.error}>{error}</p> : <section className={styles.list}>{schedules.length === 0 ? <p className={styles.empty}>No scheduled scans yet.</p> : schedules.map((schedule) => <article className={styles.row} key={schedule.id}><div><strong>{schedule.asset.value}</strong><small>{schedule.frequency} · {schedule.mode}</small></div><time>Next: {new Date(schedule.nextRunAt).toLocaleString()}</time><button onClick={() => toggle(schedule)}>{schedule.enabled ? 'Pause' : 'Resume'}</button></article>)}</section>}</main>;
}
