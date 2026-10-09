import { formatDuration } from '../../data/format'
import type { Geofence, Trip } from '../../data/types'

export interface TimelineEvent {
  kind: 'move' | 'stop' | 'end'
  time: number
  text: string
}

/**
 * Left <start>, one "Stopped N min" per stop, then the end: "Arrived at Site zone", "Arrived Town depot", or
 * "Stopped away from site" when no geofence matched (only the Site zone is drawn; other stops are just somewhere).
 * A start with no geofence reads "Started away from site".
 */
export function eventsOf(trip: Trip, geofences: Geofence[]): TimelineEvent[] {
  const isSite = (name: string | null) => name !== null && geofences.find((g) => g.name === name)?.kind === 'site'
  const start =
    trip.startPlace === null
      ? 'Started away from site'
      : `Left ${isSite(trip.startPlace) ? `${trip.startPlace} zone` : trip.startPlace}`
  const events: TimelineEvent[] = [{ kind: 'move', time: trip.startTime, text: start }]
  for (const s of [...trip.stops].sort((a, b) => a.startTime - b.startTime)) {
    events.push({ kind: 'stop', time: s.startTime, text: `Stopped ${formatDuration(s.durationMs)}` })
  }
  if (trip.endTime !== null) {
    const end =
      trip.endPlace === null
        ? 'Stopped away from site'
        : isSite(trip.endPlace)
          ? `Arrived at ${trip.endPlace} zone`
          : `Arrived ${trip.endPlace}`
    events.push({ kind: 'end', time: trip.endTime, text: end })
  }
  return events
}
