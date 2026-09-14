'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ensureCsrfToken, verifyEmail } from '../../lib/api';
import styles from '../login/page.module.css';

function VerifyEmailView() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      await ensureCsrfToken();
      if (!token) {
        if (active) setError('This verification link is missing a token.');
        return;
      }
      try {
        await verifyEmail(token);
        if (active) setDone(true);
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to verify this email');
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.mark}>S</div>
        <p className={styles.eyebrow}>SENTINEL SECURITY PLATFORM</p>
        <h1>{done ? 'Email verified' : 'Verifying email'}</h1>
        <p className={styles.copy}>{done ? 'Your address is confirmed. You can return to the dashboard.' : 'Confirming the token from your inbox…'}</p>
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.footnote}>
          <Link href="/login">Continue to sign in</Link>
        </p>
      </section>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailView />
    </Suspense>
  );
}
