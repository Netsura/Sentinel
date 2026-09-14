'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { ensureCsrfToken, register, safeNextPath } from '../../lib/api';
import styles from '../login/page.module.css';

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
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
      await register(email, password);
      router.push(safeNextPath(searchParams.get('next')));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create the account');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.mark}>S</div>
        <p className={styles.eyebrow}>SENTINEL SECURITY PLATFORM</p>
        <h1>Create your account</h1>
        <p className={styles.copy}>Monitor the posture of assets you are authorized to assess.</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button disabled={loading}>{loading ? 'Creating account...' : 'Create account'}</button>
        </form>
        <p className={styles.footnote}>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
