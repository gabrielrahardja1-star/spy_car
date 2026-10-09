import { geofenceAt } from '../../components/map/geo'
import { formatAge, formatClock, formatDuration, formatShortDay } from '../../data/format'
import type { Geofence, LiveCar, Trip } from '../../data/types'
import { AWAY_FROM_SITE, tripRoute } from '../shared/tripText'

export type ContextIcon = 'arrow' | 'pin' | 'clock'

export const NO_VALUE = '—'

export function speedText(c: LiveCar): string {
  return c.position ? `${Math.round(c.position.speedKmh)} km/h` : NO_VALUE
}

export function lastSeenText(c: LiveCar): string {
  return c.lastSeenMs === null ? 'No fix yet' : formatAge(c.lastSeenMs)
}

export function parkedForText(c: LiveCar): string {
  return c.parkedForMs === null ? NO_VALUE : formatDuration(c.parkedForMs)
}

/** Second line of the map callout, e.g. "42 km/h · 4 s ago". */
export function pinDetail(c: LiveCar): string {
  const seen = lastSeenText(c)
  if (c.status === 'moving') return `${speedText(c)} · ${seen}`
  if (c.status === 'parked') return `${parkedForText(c)} · ${seen}`
  return `Last seen ${seen}`
}

/** Clock time, with the weekday when it is not today. */
function clockOnDay(t: number, todayStart: number): string {
  return t < todayStart ? `${formatShortDay(t)} ${formatClock(t)}` : formatClock(t)
}

/**
 * The one-line context under a car's tiles:
 * moving -> "Town depot → Site · left 13:20" (or "From Town depot", or "Away from site" when no geofence matched),
 * parked -> "Inside Site zone · arrived 13:40" (or "Away from site · arrived 13:40"), no signal -> "No signal since 13:02".
 */
export function contextOf(args: {
  live: LiveCar
  /** Today's trips for this car (any order). */
  trips: Trip[]
  geofences: Geofence[]
  now: number
  todayStart: number
}): { icon: ContextIcon; text: string } {
  const { live, trips, geofences, now, todayStart } = args
  const byStart = [...trips].sort((a, b) => b.startTime - a.startTime)

  if (live.status === 'nosignal') {
    return {
      icon: 'clock',
      text: live.position ? `No signal since ${clockOnDay(live.position.fixTime, todayStart)}` : 'No position received yet',
    }
  }

  if (live.status === 'moving') {
    const current = byStart.find((t) => t.endTime === null) ?? byStart[0]
    if (!current) return { icon: 'arrow', text: 'On the move' }
    const route =
      current.endPlace !== null
        ? tripRoute(current.startPlace, current.endPlace)
        : current.startPlace !== null
          ? `From ${current.startPlace}`
          : AWAY_FROM_SITE
    return { icon: 'arrow', text: `${route} · left ${clockOnDay(current.startTime, todayStart)}` }
  }

  // parked
  const fence = live.position ? geofenceAt(live.position.lon, live.position.lat, geofences) : null
  const lastEnded = byStart.find((t) => t.endTime !== null)
  const arrivedAt = lastEnded?.endTime ?? (live.parkedForMs !== null ? now - live.parkedForMs : null)
  const where = fence ? (fence.kind === 'site' ? `Inside ${fence.name} zone` : `At ${fence.name}`) : AWAY_FROM_SITE
  return { icon: 'pin', text: arrivedAt === null ? where : `${where} · arrived ${clockOnDay(arrivedAt, todayStart)}` }
}
