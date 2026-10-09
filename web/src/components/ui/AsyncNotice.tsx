import type { Async } from '../../data/hooks'
import type { ReactNode } from 'react'
import styles from './ui.module.css'

/** Simple accessible text block for loading, error and empty states (full polish is Phase 8). */
export function AsyncNotice({ state, loading = 'Loading...' }: { state: Async<never>; loading?: string }) {
  if (state.status === 'error') {
    return (
      <div role="alert" className={`${styles.notice} ${styles.noticeError}`}>
        Can't reach the server
      </div>
    )
  }
  return (
    <div role="status" className={styles.notice}>
      {loading}
    </div>
  )
}

export function EmptyNotice({ children }: { children: ReactNode }) {
  return <div className={styles.notice}>{children}</div>
}
