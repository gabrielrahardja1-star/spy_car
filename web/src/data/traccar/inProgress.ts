// The trip a car is driving right now. Traccar only completes a trip once the car has been parked for a while
// (report.trip.minimalParkingDuration, 5 min by default); until then the report is late, empty, or ends the trip at the
// last fix without saying it is still going. This builds the open trip from the recent route. Pure.
import { config, type Config } from '../../config'
import { sortPositions } from '../derive'
import type { Geofence, Position, Trip } from '../types'
import { geofenceNameAt, pathLengthM } from './geo'
import { derivePauses, totalPauseMs } from './pauses'

/** Mirrors Traccar's default minimalParkingDuration: a still run this long ends a trip. */
export const PARKING_ENDS_TRIP_MS = 5 * 60_000
/** A Traccar trip whose end is this close to the latest fix is the trip still going (the report cuts it at the last fix). */
export const OPEN_TRIP_TOLERANCE_MS = 3 * 60_000

const isMoving = (p: Position, cfg: Config) => p.speedKmh > cfg.movingKmh || p.motion

/** Start of the unbroken driving at the end of `fixes` (sorted): the first moving fix after the last long parked run. */
export function drivingStart(fixes: Position[], cfg: Config = config): number | null {
  let start: number | null = null
  // A still run seen while walking back: it ends where the next (moving) fix is, and began at its earliest still fix.
  let runEnd: number | null = null
  let runStart = 0
  for (let i = fixes.length - 1; i >= 0; i--) {
    const p = fixes[i]
    if (isMoving(p, cfg)) {
      if (runEnd !== null && runEnd - runStart >= PARKING_ENDS_TRIP_MS) break
      runEnd = null
      start = p.fixTime
    } else {
      if (runEnd === null) runEnd = i + 1 < fixes.length ? fixes[i + 1].fixTime : p.fixTime
      runStart = p.fixTime
    }
  }
  return start
}

/**
 * The open trip, or null when the car is not driving. `route` is the car's recent fixes (any order) reaching back at
 * least to where the trip began; `openTripStart` is the start of Traccar's own unfinished trip if it reported one
 * (authoritative), otherwise the start is found from the route. `deriveStops` false leaves stops unknown.
 * Distance is the haversine length of the route since the start; driving time excludes derived pauses.
 */
export function buildInProgressTrip(args: {
  carId: string
  latest: Position | null
  route: Position[]
  openTripStart: number | null
  geofences: Geofence[]
  now: number
  deriveStops: boolean
  cfg?: Config
}): Trip | null {
  const { carId, latest, geofences, now } = args
  const cfg = args.cfg ?? config
  if (!latest || now - latest.fixTime > cfg.noSignalMs || !isMoving(latest, cfg)) return null

  const all = sortPositions([...args.route.filter((p) => p.carId === carId), latest])
  const startTime = args.openTripStart ?? drivingStart(all, cfg)
  if (startTime === null) return null
  const fixes = all.filter((p) => p.fixTime >= startTime)
  if (fixes.length === 0) return null
  const endOfData = fixes[fixes.length - 1].fixTime

  const trip: Trip = {
    id: `${carId}-${startTime}`,
    carId,
    startTime,
    endTime: null,
    startPlace: geofenceNameAt(fixes[0].lat, fixes[0].lon, geofences),
    endPlace: null,
    distanceM: Math.round(pathLengthM(fixes)),
    drivingMs: Math.max(0, endOfData - startTime),
    maxSpeedKmh: Math.max(...fixes.map((p) => p.speedKmh)),
    stops: [],
  }
  if (args.deriveStops) {
    trip.stops = derivePauses({ carId, start: startTime, end: endOfData, fixes, geofences, cfg })
    trip.drivingMs = Math.max(0, trip.drivingMs - totalPauseMs(trip.stops))
  } else {
    trip.stopsKnown = false
  }
  return trip
}

/** Traccar's unfinished trip for the car, if it reports one: the newest trip that ends at (or just before) the latest fix. */
export function findOpenTrip(trips: Trip[], latest: Position | null): Trip | null {
  if (!latest) return null
  const newest = trips.reduce<Trip | null>((best, t) => (best === null || t.startTime > best.startTime ? t : best), null)
  return newest && newest.endTime !== null && latest.fixTime - newest.endTime <= OPEN_TRIP_TOLERANCE_MS ? newest : null
}

/** Replaces Traccar's own open trip (if any) with the in-progress one; appends it otherwise. Newest first. */
export function withInProgress(trips: Trip[], open: Trip | null, inProgress: Trip | null): Trip[] {
  if (!inProgress) return trips
  const kept = open ? trips.filter((t) => t.id !== open.id) : trips
  return [inProgress, ...kept].sort((a, b) => b.startTime - a.startTime)
}
