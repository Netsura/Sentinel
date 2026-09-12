'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../../../components/AppShell';
import { createAsset, listAssets, verifyAsset, type Asset, type AssetType } from '../../../lib/api';
import { relativeTime } from '../../../lib/format';
import styles from './page.module.css';

const ASSET_TYPES: Array<{ type: AssetType; label: string; hint: string }> = [
  { type: 'DOMAIN', label: 'Domain', hint: 'example.com' },
  { type: 'SUBDOMAIN', label: 'Subdomain', hint: 'api.example.com' },
  { type: 'IP', label: 'Public IP', hint: '203.0.113.10' },
];

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [type, setType] = useState<AssetType>('DOMAIN');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    listAssets()
      .then(setAssets)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : 'Unable to load assets'));
  }, []);

  useEffect(load, [load]);

  async function addAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const asset = await createAsset(type, value.trim());
      setValue('');
      setAssets((current) => [asset, ...current]);
      setExpanded(asset.verificationStatus === 'VERIFIED' ? null : asset.id);
      setNotice(
        asset.verificationStatus === 'VERIFIED'
          ? `${asset.value} was added and is ready to scan.`
          : `${asset.value} was added. Publish the DNS record below, then verify ownership.`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to add the asset');
    } finally {
      setBusy(false);
    }
  }

  async function runVerification(asset: Asset) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await verifyAsset(asset.id);
      setAssets((current) => current.map((item) => (item.id === asset.id ? { ...item, verificationStatus: result.verificationStatus } : item)));
      setNotice(
        result.verificationStatus === 'VERIFIED'
          ? `${asset.value} is verified and ready for active scans.`
          : `Verification failed for ${asset.value}. DNS changes can take a few minutes to propagate.`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to verify the asset');
    } finally {
      setBusy(false);
    }
  }

  const activeType = ASSET_TYPES.find((option) => option.type === type);

  return (
    <>
      <PageHeader
        eyebrow="SCOPE"
        title="Assets"
        subtitle="Sentinel only scans targets you have proven you control. Domains require a DNS record before active scan modes unlock."
      />

      <form className={styles.addPanel} onSubmit={addAsset}>
        <label>
          Type
          <select value={type} onChange={(event) => setType(event.target.value as AssetType)}>
            {ASSET_TYPES.map((option) => (
              <option key={option.type} value={option.type}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.grow}>
          Target
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={activeType?.hint}
            required
            minLength={3}
            aria-label="Asset target"
          />
        </label>
        <button disabled={busy || !value.trim()}>{busy ? 'Working…' : 'Add asset'}</button>
      </form>

      {error && <p className={styles.error}>{error}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}

      <section className={styles.list}>
        {assets.length === 0 ? (
          <p className={styles.empty}>No assets yet. Add the first domain or IP you are authorized to assess.</p>
        ) : (
          assets.map((asset) => (
            <article className={styles.row} key={asset.id}>
              <div className={styles.main}>
                <div className={styles.identity}>
                  <strong>{asset.value}</strong>
                  <small>
                    {asset.type} · added {relativeTime(asset.createdAt)}
                  </small>
                </div>

                <span className={`${styles.status} ${styles[asset.verificationStatus.toLowerCase()]}`}>{asset.verificationStatus}</span>

                <span className={styles.score}>
                  {asset.securityScore === null ? '—' : asset.securityScore}
                  <small>score</small>
                </span>

                <span className={styles.lastScan}>{asset.lastScanAt ? relativeTime(asset.lastScanAt) : 'never scanned'}</span>

                <div className={styles.actions}>
                  {asset.verificationStatus !== 'VERIFIED' && (
                    <button className={styles.secondary} onClick={() => void runVerification(asset)} disabled={busy}>
                      Verify
                    </button>
                  )}
                  {asset.type !== 'IP' && (
                    <button className={styles.ghost} onClick={() => setExpanded(expanded === asset.id ? null : asset.id)} aria-expanded={expanded === asset.id}>
                      {expanded === asset.id ? 'Hide setup' : 'Setup'}
                    </button>
                  )}
                  <Link className={styles.primary} href={`/scans?asset=${asset.id}`}>
                    Scan
                  </Link>
                </div>
              </div>

              {expanded === asset.id && asset.type !== 'IP' && <VerificationInstructions asset={asset} />}
            </article>
          ))
        )}
      </section>
    </>
  );
}

function VerificationInstructions({ asset }: { asset: Asset }) {
  const [copied, setCopied] = useState<string | null>(null);
  const recordName = `_sentinel.${asset.value}`;
  const recordValue = `sentinel-verification=${asset.verificationToken ?? ''}`;

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className={styles.instructions}>
      <p className={styles.instructionsIntro}>
        Publish this TXT record at your DNS provider, then press Verify. Active scan modes stay locked until ownership is proven.
      </p>
      <dl className={styles.record}>
        <div>
          <dt>Type</dt>
          <dd>TXT</dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>
            <code>{recordName}</code>
            <button className={styles.copy} onClick={() => void copy('name', recordName)}>
              {copied === 'name' ? 'Copied' : 'Copy'}
            </button>
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>
            <code>{recordValue}</code>
            <button className={styles.copy} onClick={() => void copy('value', recordValue)}>
              {copied === 'value' ? 'Copied' : 'Copy'}
            </button>
          </dd>
        </div>
      </dl>
    </div>
  );
}
