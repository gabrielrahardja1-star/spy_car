import type { Geofence, Position, Trip } from '../data/types'
import { CAR_1, CAR_2, createFakeSource, position, trip } from './fakeSource'
import { FIXED_NOW, localTime } from './render'

export const SITE_ZONE: Geofence = {
  id: 'g-site',
  name: 'Site',
  kind: 'site',
  polygon: [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ],
}
export const DEPOT: Geofence = {
  id: 'g-depot',
  name: 'Town depot',
  kind: 'place',
  polygon: [
    [10, 10],
    [10, 11],
    [11, 11],
    [11, 10],
    [10, 10],
  ],
}

export const TRIP_A = trip(CAR_1.id, localTime(7, 42), localTime(9, 5), {
  startPlace: 'Site',
  endPlace: 'Town depot',
  distanceM: 41_000,
  drivingMs: 72 * 60_000,
  stops: [3, 8].map((min, i) => ({
    carId: CAR_1.id,
    startTime: localTime(7, 58) + i * 38 * 60_000,
    endTime: localTime(7, 58) + i * 38 * 60_000 + min * 60_000,
    durationMs: min * 60_000,
    lat: 0,
    lon: 0,
    place: null,
  })),
})
export const TRIP_B = trip(CAR_1.id, localTime(13, 20), null, {
  startPlace: 'Town depot',
  endPlace: 'Site',
  distanceM: 23_000,
  drivingMs: 58 * 60_000,
})
export const TRIP_C = trip(CAR_2.id, localTime(12, 25), localTime(13, 40), {
  startPlace: 'Supplier yard',
  endPlace: 'Site',
  distanceM: 38_000,
  drivingMs: 75 * 60_000,
})

/** Car 02 reports every minute except for a 6 minute break from 12:58 to 13:04. */
function car2Fixes(): Position[] {
  const out: Position[] = []
  for (let t = localTime(12, 25); t <= localTime(13, 40); t += 60_000) {
    if (t > localTime(12, 58) && t < localTime(13, 4)) continue
    out.push(position(CAR_2.id, t, { speedKmh: 40, motion: true, lat: 5, lon: 5 }))
  }
  return out
}

/**
 * Car 01: moving, fix 4 s old, on a trip that started 13:20. Car 02: last fix 13:40 (38 min old) so it shows
 * No signal, with a signal gap inside its trip. Both cars have trips today.
 * `extraTrips` adds trips (other days, say) without touching the story.
 */
export function dayScenario(extraTrips: Trip[] = []) {
  return createFakeSource({
    geofences: [SITE_ZONE, DEPOT],
    positions: [position(CAR_1.id, FIXED_NOW - 4000, { speedKmh: 42, motion: true, lat: 5, lon: 5 }), ...car2Fixes()],
    trips: [TRIP_A, TRIP_B, TRIP_C, ...extraTrips],
  })
}
