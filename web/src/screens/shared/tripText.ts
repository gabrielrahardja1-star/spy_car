import { formatClock, formatDuration, formatShortDay } from '../../data/format'
import type { Trip } from '../../data/types'

/**
 * Only the Site zone is drawn on purpose; stores and other stops are not geofences. So "no geofence here" is a normal
 * answer and reads as "Away from site", never as an error.
 */
export const AWAY_FROM_SITE = 'Away from site'

export function placeName(name: string | null): string {
  return name ?? AWAY_FROM_SITE
}

/** "Site → away", "Away → Site", "Away → away", "Site → Town depot". Unnamed ends read "Away" first and "away" second. */
export function tripRoute(startPlace: string | null, endPlace: string | null): string {
  return `${startPlace ?? 'Away'} \u2192 ${endPlace ?? 'away'}`
}

/** The trip's title. A trip still under way may not have a known destination yet. */
export function tripTitle(trip: Trip): string {
  if (trip.endTime === null && trip.endPlace === null) return `${placeName(trip.startPlace)}, on the way`
  return tripRoute(trip.startPlace, trip.endPlace)
}

/**
 * Server-supplied addresses as one secondary line, for ends that no geofence matched: "From X to Y", "From X" or
 * "To Y". null when there is nothing to add (every end is a named place, or the server had no address).
 */
export function tripAddressLine(trip: Trip): string | null {
  const from = trip.startPlace === null ? trip.startAddress : undefined
  const to = trip.endPlace === null && trip.endTime !== null ? trip.endAddress : undefined
  if (from && to) return `From ${from} to ${to}`
  if (from) return `From ${from}`
  if (to) return `To ${to}`
  return null
}

/** "07:42 – 09:05" or "13:20 – now". With `withDay` the start day is prefixed ("Wed 7 · 07:42 – 09:05"). */
export function tripTimeRange(trip: Trip, withDay = false): string {
  const end = trip.endTime === null ? 'now' : formatClock(trip.endTime)
  const range = `${formatClock(trip.startTime)} – ${end}`
  return withDay ? `${formatShortDay(trip.startTime)} · ${range}` : range
}

export function totalStopMs(trip: Trip): number {
  return trip.stops.reduce((sum, s) => sum + s.durationMs, 0)
}

/** "2 trips" / "1 trip" */
export function tripCountText(n: number): string {
  return `${n} ${n === 1 ? 'trip' : 'trips'}`
}

/** "—" when the stops of this trip could not be worked out (long ranges on a real tracker server), else the count. */
export function stopsCount(trip: Trip): string {
  return trip.stopsKnown === false ? '\u2014' : String(trip.stops.length)
}

export function stopsSummary(trip: Trip): string {
  if (trip.stopsKnown === false) return '\u2014'
  return trip.stops.length === 0 ? '0' : `${trip.stops.length} · ${formatDuration(totalStopMs(trip))}`
}
