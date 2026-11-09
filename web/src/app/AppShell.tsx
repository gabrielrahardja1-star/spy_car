import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useDataSource } from '../data/DataProvider'
import { useCanEditLocations, useCanEditTrucks, useCars, useLastMessageAt, useNow } from '../data/hooks'
import type { ConnectionState } from '../data/source'
import { useSession } from './session'
import styles from './AppShell.module.css'

/** Stroke icons for the rail, 24px grid. */
const ICONS = {
  live: ['M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z', 'M9 3v15', 'M15 6v15'],
  history: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  dashboard: ['M3 21h18', 'M6 17v-6', 'M11 17V5', 'M16 17v-9', 'M21 17v-3'],
  manage: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
}

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** `name` is what screen readers announce; `short` fits under the icon. */
const tabs = [
  { to: '/', name: 'Live map', short: 'Live', icon: 'live', end: true },
  { to: '/history', name: 'Route history', short: 'History', icon: 'history', end: false },
  { to: '/dashboard', name: 'Dashboard', short: 'Dashboard', icon: 'dashboard', end: false },
] as const
/** Only for admins who may change trucks or locations. */
const MANAGE_TAB = { to: '/manage', name: 'Manage', short: 'Manage', icon: 'manage', end: false } as const

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
      <span className={styles.chipLabel}>
        <span className={styles.chipDot} aria-hidden="true" />
        Live
      </span>
      <span className={styles.chipAge}>{warning ? `${age} · ${warning}` : age}</span>
    </div>
  )
}

function LogoutButton() {
  const session = useSession()
  if (!session) return null
  return (
    <button type="button" className={styles.logout} onClick={session.logout}>
      <Icon name="logout" />
      <span>Log out</span>
    </button>
  )
}

function Subtitle() {
  const cars = useCars()
  return <div className={styles.appSub}>{cars.status === 'ready' ? `Mine haulage · ${cars.data.length} trucks` : 'Mine haulage'}</div>
}

export function AppShell() {
  const canEditTrucks = useCanEditTrucks()
  const canEditLocations = useCanEditLocations()
  const canManage = canEditTrucks || canEditLocations
  return (
    <div className={styles.page}>
      <aside className={styles.rail}>
        <div className={styles.brand}>
          <div className={styles.logo} title="Haul Truck Tracker">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E6F0FF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div className={styles.brandText}>
            <div className={styles.appName}>Haul Truck Tracker</div>
            <Subtitle />
          </div>
        </div>
        <nav aria-label="Views" className={styles.tabs}>
          {[...tabs, ...(canManage ? [MANAGE_TAB] : [])].map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={styles.tab} aria-label={t.name}>
              <Icon name={t.icon} />
              <span className={styles.tabLabel}>{t.short}</span>
            </NavLink>
          ))}
        </nav>
        <div className={styles.railFoot}>
          <LiveChip />
          <LogoutButton />
        </div>
      </aside>
      <div className={styles.main}>
        <Outlet />
      </div>
    </div>
  )
}
