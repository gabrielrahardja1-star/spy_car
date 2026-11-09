import { formatDuration } from '../../data/format'
import type { Geofence, Position, Trip } from '../../data/types'
import { zoneEvents } from '../../data/zones'

export interface TimelineEvent {
  kind: 'move' | 'stop' | 'end' | 'checkpoint'
  time: number
  text: string
}

/**
 * Left <start>, one "Stopped N min" per stop, then the end: "Arrived at Site zone", "Arrived Town depot", or
 * "Stopped away from site" when no geofence matched (only the Site zone is drawn; other stops are just somewhere).
 * A start with no geofence reads "Started away from site".
 * With the trip's `route`, checkpoint passes ("Passed CP1 West gate") and zones driven through on the way
 * ("Entered Pit N", "Left Pit N") are added between them.
 */
export function eventsOf(trip: Trip, geofences: Geofence[], route: Position[] = []): TimelineEvent[] {
  const isSite = (name: string | null) => name !== null && geofences.find((g) => g.name === name)?.kind === 'site'
  const start =
    trip.startPlace === null
      ? 'Started away from site'
      : `Left ${isSite(trip.startPlace) ? `${trip.startPlace} zone` : trip.startPlace}`
  const events: TimelineEvent[] = [{ kind: 'move', time: trip.startTime, text: start }]
  for (const s of [...trip.stops].sort((a, b) => a.startTime - b.startTime)) {
    events.push({ kind: 'stop', time: s.startTime, text: `Stopped ${formatDuration(s.durationMs)}` })
  }
  const end = trip.endTime ?? Infinity
  for (const z of zoneEvents(route, geofences)) {
    if (z.time <= trip.startTime || z.time >= end) continue
    if (z.kind === 'pass') events.push({ kind: 'checkpoint', time: z.time, text: `Passed ${z.name}` })
    // Leaving the start zone and arriving at the end zone are already the first and last rows.
    else if (z.kind === 'enter' && z.name !== trip.endPlace) events.push({ kind: 'move', time: z.time, text: `Entered ${z.name}` })
    else if (z.kind === 'exit' && z.name !== trip.startPlace) events.push({ kind: 'move', time: z.time, text: `Left ${z.name}` })
  }
  events.sort((a, b) => a.time - b.time)
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
