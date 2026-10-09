import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Card } from '../../components/ui/Card'
import type { LoginResult } from '../../data/traccar'
import styles from './Login.module.css'

interface Props {
  onSubmit: (email: string, password: string) => Promise<LoginResult>
  /** Shown above the form, e.g. "Your session ended. Sign in again." or a failed start-up check. */
  notice?: string | null
}

export const WRONG_LOGIN = 'Wrong email or password'
export const UNREACHABLE = "Can't reach the server"

/** Sign-in form for Traccar mode. The password stays in this component's state only while the user types it. */
export function Login({ onSubmit, notice }: Props) {
  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onSubmit(email.trim(), password)
    // On success the gate swaps this screen out; nothing more to do.
    if (!result.ok) {
      setError(result.reason === 'invalid' ? WRONG_LOGIN : UNREACHABLE)
      setPassword('')
      setBusy(false)
    }
  }

  const shown = error ?? (notice === UNREACHABLE ? notice : null)
  const info = error === null && notice !== UNREACHABLE ? notice : null

  return (
    <main className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.logo} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E6F0FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div className={styles.appName}>Site Car Tracker</div>
        </div>
        <h1 className={styles.title}>Sign in</h1>
        {info && (
          <div role="status" className={styles.info}>
            {info}
          </div>
        )}
        <form className={styles.form} onSubmit={submit} aria-busy={busy}>
          <div className={styles.field}>
            <label htmlFor={emailId} className={styles.label}>
              Email
            </label>
            <input
              id={emailId}
              className={styles.input}
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error === WRONG_LOGIN}
              aria-describedby={shown ? errorId : undefined}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={passwordId} className={styles.label}>
              Password
            </label>
            <input
              id={passwordId}
              className={styles.input}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error === WRONG_LOGIN}
              aria-describedby={shown ? errorId : undefined}
            />
          </div>
          {shown && (
            <div id={errorId} role="alert" className={styles.error}>
              {shown}
            </div>
          )}
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </Card>
    </main>
  )
}
