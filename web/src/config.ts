// Single place for thresholds and environment-driven settings (PLAN.md 5.3, 5.2).
export interface Config {
  /** IANA zone used to display every time. Traccar stores UTC. */
  timezone: string
  /** Above this speed (km/h) a car with a fresh fix counts as moving. */
  movingKmh: number
  /** A last fix older than this means "No signal". Also the minimum length of a signal gap. */
  noSignalMs: number
  /** Hour-by-hour strip range, local hours. */
  workdayStartHour: number
  workdayEndHour: number
  dataSource: 'mock' | 'traccar'
  /** Traccar origin, e.g. "https://tracker.example.com". Empty = same origin as the app (the production setup). */
  traccarUrl: string
  /** Name of the Traccar geofence that is the work-site zone (matched case-insensitively). Every other geofence is a plain place. */
  siteGeofenceName: string
  /** Shortest pause inside a trip that counts as a stop (derived from the route, Traccar does not report it). */
  minPauseMs: number
  /** Pauses are derived from per-trip routes only for ranges up to this long; longer ranges show "—" for stops. */
  pauseDeriveMaxRangeMs: number
}

export const config: Config = {
  timezone: import.meta.env.VITE_TIMEZONE ?? 'Asia/Makassar',
  movingKmh: 3,
  noSignalMs: 5 * 60 * 1000,
  workdayStartHour: 6,
  workdayEndHour: 18,
  dataSource: import.meta.env.VITE_DATA_SOURCE === 'traccar' ? 'traccar' : 'mock',
  traccarUrl: (import.meta.env.VITE_TRACCAR_URL ?? '').replace(/\/+$/, ''),
  siteGeofenceName: import.meta.env.VITE_SITE_GEOFENCE_NAME || 'Site',
  minPauseMs: 2 * 60 * 1000,
  pauseDeriveMaxRangeMs: 2 * 24 * 60 * 60 * 1000,
}
