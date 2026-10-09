import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useDataSource } from '../data/DataProvider'
import { useCars, useLastMessageAt, useNow } from '../data/hooks'
import type { ConnectionState } from '../data/source'
import { useSession } from './session'
import styles from './AppShell.module.css'

const tabs = [
  { to: '/', label: 'Live map', end: true },
  { to: '/history', label: 'Route history', end: false },
  { to: '/dashboard', label: 'Dashboard', end: false },
]

/** Live link state from sources that have one (Traccar). Sources without one count as connected. */
function useConnection(): ConnectionState {
  const source = useDataSource()
  const [state, setState] = useState<ConnectionState>('connected')
  useEffect(() => source.onConnectionChange?.(setState), [source])
  return state
}

/**
 * "Live · updated N s ago", counting up from the last live message. Before the first message: waiting for data.
 * When the live link drops the chip says so (Phase 8 polishes this); the age keeps counting.
 */
function LiveChip() {
  const lastMessageAt = useLastMessageAt()
  const connection = useConnection()
  const now = useNow()
  const age =
    lastMessageAt === null ? 'waiting for data' : `updated ${Math.max(0, Math.floor((now - lastMessageAt) / 1000))} s ago`
  // The first connect is "waiting for data"; only a link that was up and dropped, or a long outage, is worth a warning.
  const warning = connection === 'offline' ? 'offline' : connection === 'reconnecting' && lastMessageAt !== null ? 'reconnecting' : null
  return (
    <div className={styles.chip}>
      <span className={styles.chipDot} aria-hidden="true" />
      <span className={styles.chipLabel}>Live</span>
      <span className={styles.chipAge}>{warning ? `${age} · ${warning}` : age}</span>
    </div>
  )
}

function LogoutButton() {
  const session = useSession()
  if (!session) return null
  return (
    <button type="button" className={styles.logout} onClick={session.logout}>
      Log out
    </button>
  )
}

function Subtitle() {
  const cars = useCars()
  return <div className={styles.appSub}>{cars.status === 'ready' ? `Purchasing · ${cars.data.length} cars` : 'Purchasing'}</div>
}

export function AppShell() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E6F0FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div>
            <div className={styles.appName}>Site Car Tracker</div>
            <Subtitle />
          </div>
        </div>
        <nav aria-label="Views" className={styles.tabs}>
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={styles.tab}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <LiveChip />
        <LogoutButton />
      </header>
      <div className={styles.main}>
        <Outlet />
      </div>
    </div>
  )
}
