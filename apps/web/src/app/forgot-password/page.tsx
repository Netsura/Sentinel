'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ensureCsrfToken, forgotPassword } from '../../lib/api';
import styles from '../login/page.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void ensureCsrfToken();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const result = await forgotPassword(email);
      setNotice(result.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send reset instructions');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.mark}>S</div>
        <p className={styles.eyebrow}>SENTINEL SECURITY PLATFORM</p>
        <h1>Reset password</h1>
        <p className={styles.copy}>We will email reset instructions if that address is registered.</p>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          {notice && <p className={styles.copy}>{notice}</p>}
          <button disabled={loading}>{loading ? 'Sending...' : 'Send instructions'}</button>
        </form>
        <p className={styles.footnote}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
