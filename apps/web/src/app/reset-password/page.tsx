'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { ensureCsrfToken, resetPassword } from '../../lib/api';
import styles from '../login/page.module.css';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void ensureCsrfToken();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      router.push('/login');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to reset the password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.mark}>S</div>
        <p className={styles.eyebrow}>SENTINEL SECURITY PLATFORM</p>
        <h1>Choose a new password</h1>
        <p className={styles.copy}>Use at least 12 characters. This invalidates every other signed-in session.</p>
        <form onSubmit={submit}>
          <label>
            New password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} autoComplete="new-password" />
          </label>
          <label>
            Confirm password
            <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} autoComplete="new-password" />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button disabled={loading || !token}>{loading ? 'Saving...' : 'Update password'}</button>
        </form>
        <p className={styles.footnote}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
