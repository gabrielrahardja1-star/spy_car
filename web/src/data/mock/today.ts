// "Today": a scripted story anchored to the clock at creation time.
//   DT-01: haul cycles CWP <-> Area 2 since the shift started, now on a live loop that left CWP 6 minutes ago.
//   DT-02: one slow loaded run Ventilasi -> Area 2, held 7 minutes at a crossing and with a 6 minute signal gap, then parked
//   in Area 2.
// Everything is placed relative to `anchor` (but never before the start of the local day), so it looks right at any hour.
import type { Position, SignalGap, Trip } from '../types'
import { CWP, SITE, VENTILASI, placeAt } from './places'
import { pointAt, roadPath, toPath, type Path } from './route'
import { buildTrip, createLoopDriver, measure, tripId, type LoopDriver } from './trips'
import { HOUR, hashSeed, makeFix, MINUTE } from './util'

export const CAR1 = 'c1'
export const CAR2 = 'c2'
const TODAY_INTERVAL_MS = 10_000
export const HEARTBEAT_MS = 30_000
/** Haul cycle timings: loading at the pit, queueing and tipping at the dump (5 min or more, so Traccar ends the trip). */
export const LOAD_MS = 6 * MINUTE
export const DUMP_MS = 5 * MINUTE
export const LOADED_KMH = 18
export const EMPTY_KMH = 28

type Piece =
  | { kind: 'trip'; trip: Trip; fixes: Position[] }
  | { kind: 'park'; from: number; to: number; lat: number; lon: number; course: number }
  | { kind: 'live'; start: number; driver: LoopDriver }

export interface TodayPlan {
  dayStart: number
  cars: { carId: string; pieces: Piece[] }[]
  gaps: SignalGap[]
}

export interface TodayView {
  /** Chronological. */
  trips: Trip[]
  /** Per car, ascending by fixTime, none after the materialised time. */
  fixes: Map<string, Position[]>
}

function parkAt(path: Path, atEnd: boolean, from: number, to: number): Piece {
  const pt = pointAt(path, atEnd ? path.length : 0)
  return { kind: 'park', from, to, lat: pt.lat, lon: pt.lon, course: pt.course }
}

/** Whole seconds to drive `path` at `kmh` on average. */
export const legMs = (path: Path, kmh: number) => Math.round((path.length / 1000 / kmh) * 3600) * 1000

export function buildTodayPlan(dayStart: number, anchor: number): TodayPlan {
  const gaps: SignalGap[] = []
  const loaded = roadPath(CWP.road, true)
  const empty = roadPath(CWP.road, false)

  // DT-01: the endless loop CWP -> Area 2 -> CWP, started 6 minutes ago.
  const liveStart = Math.max(dayStart, anchor - 6 * MINUTE)
  const loop = toPath([...CWP.road, ...CWP.road.slice(0, -1).reverse()])
  const driver = createLoopDriver(CAR1, loop, liveStart, TODAY_INTERVAL_MS, 26, hashSeed(dayStart, 3))

  // Finished cycles from 06:30, each: load, loaded run, dump, empty run. The last load ends when the live loop starts.
  const car1: Piece[] = []
  const loadedMs = legMs(loaded, LOADED_KMH)
  const emptyMs = legMs(empty, EMPTY_KMH)
  const cycleMs = LOAD_MS + loadedMs + DUMP_MS + emptyMs
  let t = dayStart + 6 * HOUR + 30 * MINUTE
  let parkedSince = dayStart
  for (let i = 0; t + cycleMs + LOAD_MS <= liveStart; i++) {
    const legs: [Path, number, number][] = [
      [loaded, t + LOAD_MS, loadedMs],
      [empty, t + LOAD_MS + loadedMs + DUMP_MS, emptyMs],
    ]
    for (const [path, start, drivingMs] of legs) {
      const built = buildTrip({ carId: CAR1, start, path, drivingMs, stops: [], intervalMs: TODAY_INTERVAL_MS, seed: hashSeed(dayStart, 4, i, start) })
      car1.push(parkAt(path, false, parkedSince, start))
      car1.push({ kind: 'trip', trip: built.trip, fixes: built.fixes })
      parkedSince = built.trip.endTime as number
    }
    t += cycleMs
  }
  car1.push(parkAt(loaded, false, parkedSince, liveStart))
  car1.push({ kind: 'live', start: liveStart, driver })

  // DT-02: Ventilasi -> Area 2 loaded at 12 km/h, ending by 13:40: held 2 minutes in (7 min, so real Traccar splits the
  // trip there), then a 6 minute gap 10 minutes in.
  const car2: Piece[] = []
  const haul = roadPath(VENTILASI.road, true)
  const haulMs = legMs(haul, 12)
  const tripEnd = Math.min(dayStart + 13 * HOUR + 40 * MINUTE, anchor - 20 * MINUTE)
  const holdMs = 7 * MINUTE
  const tripStart = tripEnd - haulMs - holdMs
  if (tripStart >= dayStart) {
    const built = buildTrip({
      carId: CAR2,
      start: tripStart,
      path: haul,
      drivingMs: haulMs,
      stops: [{ atDrivingMs: 2 * MINUTE, durMs: holdMs }],
      intervalMs: TODAY_INTERVAL_MS,
      gap: { offsetMs: 10 * MINUTE, durMs: 6 * MINUTE },
      seed: hashSeed(dayStart, 5),
    })
    car2.push(parkAt(haul, false, dayStart, tripStart))
    car2.push({ kind: 'trip', trip: built.trip, fixes: built.fixes })
    car2.push(parkAt(haul, true, tripEnd, Infinity))
    if (built.gap) gaps.push(built.gap)
  } else {
    car2.push({ kind: 'park', from: dayStart, to: Infinity, lat: SITE.lat, lon: SITE.lon, course: 0 })
  }

  return {
    dayStart,
    cars: [
      { carId: CAR1, pieces: car1 },
      { carId: CAR2, pieces: car2 },
    ],
    gaps,
  }
}

/** Everything that exists at `now`: finished trips and fixes, plus the live trip so far. */
export function materialize(plan: TodayPlan, now: number): TodayView {
  const trips: Trip[] = []
  const fixes = new Map<string, Position[]>()
  for (const car of plan.cars) {
    const out: Position[] = []
    let lastT = -Infinity
    const push = (p: Position) => {
      if (p.fixTime > lastT && p.fixTime <= now) {
        out.push(p)
        lastT = p.fixTime
      }
    }
    for (const piece of car.pieces) {
      if (piece.kind === 'trip') {
        if (piece.trip.endTime !== null && piece.trip.endTime <= now) trips.push(piece.trip)
        piece.fixes.forEach(push)
      } else if (piece.kind === 'park') {
        for (let t = Math.ceil(piece.from / HEARTBEAT_MS) * HEARTBEAT_MS; t < piece.to && t <= now; t += HEARTBEAT_MS) {
          push(makeFix(car.carId, t, piece.lat, piece.lon, 0, piece.course))
        }
      } else {
        const liveFixes = piece.driver.fixesUpTo(now)
        liveFixes.forEach(push)
        if (liveFixes.length > 0) {
          const { distanceM, maxSpeedKmh } = measure(liveFixes)
          const first = liveFixes[0]
          const last = liveFixes[liveFixes.length - 1]
          trips.push({
            id: tripId(car.carId, piece.start),
            carId: car.carId,
            startTime: piece.start,
            endTime: null,
            startPlace: placeAt(first.lat, first.lon),
            endPlace: null,
            distanceM,
            drivingMs: last.fixTime - first.fixTime,
            maxSpeedKmh,
            stops: [],
          })
        }
      }
    }
    fixes.set(car.carId, out)
  }
  trips.sort((a, b) => a.startTime - b.startTime)
  return { trips, fixes }
}

/** The car's position at `t` for the live feed: interpolated while looping, a heartbeat fix while parked. */
export function positionAt(plan: TodayPlan, carId: string, t: number): Position | null {
  const car = plan.cars.find((c) => c.carId === carId)
  if (!car) return null
  for (const piece of car.pieces) {
    if (piece.kind === 'live') {
      if (t >= piece.start) return piece.driver.positionAt(t)
    } else if (piece.kind === 'park') {
      if (t >= piece.from && t < piece.to) {
        const fixTime = Math.max(piece.from, Math.floor(t / HEARTBEAT_MS) * HEARTBEAT_MS)
        return makeFix(carId, fixTime, piece.lat, piece.lon, 0, piece.course)
      }
    } else if (t >= piece.trip.startTime && piece.trip.endTime !== null && t < piece.trip.endTime) {
      const past = piece.fixes.filter((f) => f.fixTime <= t)
      return past[past.length - 1] ?? null
    }
  }
  return null
}
