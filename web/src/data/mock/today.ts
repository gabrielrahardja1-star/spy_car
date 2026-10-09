// "Today": a scripted story anchored to the clock at creation time.
//   Car 01: morning trip Site -> Town depot, parked at the depot, then looping back towards Site (in progress).
//   Car 02: trip Supplier yard -> Site with a 6 minute signal gap, then parked inside Site.
// Everything is placed relative to `anchor` (but never before the start of the local day), so it looks right at any hour.
import type { Position, SignalGap, Trip } from '../types'
import { DEPOT, SITE, SUPPLIER, placeAt, type PlaceDef } from './places'
import { makePath, pointAt, toPath, type Path } from './route'
import { buildTrip, createLoopDriver, measure, tripId, type LoopDriver } from './trips'
import { haversineM, HOUR, hashSeed, makeFix, mulberry32, MINUTE } from './util'

export const CAR1 = 'c1'
export const CAR2 = 'c2'
const TODAY_INTERVAL_MS = 10_000
export const HEARTBEAT_MS = 30_000

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

const straightM = (a: PlaceDef, b: PlaceDef) => haversineM(a.centre[0], a.centre[1], b.centre[0], b.centre[1])

function parkAt(path: Path, atEnd: boolean, from: number, to: number): Piece {
  const pt = pointAt(path, atEnd ? path.length : 0)
  return { kind: 'park', from, to, lat: pt.lat, lon: pt.lon, course: pt.course }
}

export function buildTodayPlan(dayStart: number, anchor: number): TodayPlan {
  const rng = mulberry32(hashSeed(dayStart, 99))
  const gaps: SignalGap[] = []

  // Car 01: the endless loop Depot -> Site -> Depot, started 58 minutes ago.
  const liveStart = Math.max(dayStart, anchor - 58 * MINUTE)
  const outward = makePath(DEPOT.centre, SITE.centre, mulberry32(hashSeed(dayStart, 1)), straightM(DEPOT, SITE) * 1.31)
  const back = makePath(SITE.centre, DEPOT.centre, mulberry32(hashSeed(dayStart, 2)), straightM(DEPOT, SITE) * 1.27)
  const loop = toPath([
    ...outward.lat.map((la, i): [number, number] => [la, outward.lon[i]]),
    ...back.lat.slice(1).map((la, i): [number, number] => [la, back.lon[i + 1]]),
  ])
  const driver = createLoopDriver(CAR1, loop, liveStart, TODAY_INTERVAL_MS, 42, hashSeed(dayStart, 3))

  const morningEnd = Math.min(dayStart + 9 * HOUR + 5 * MINUTE, liveStart - 30 * MINUTE)
  const morningStart = morningEnd - 83 * MINUTE
  const car1: Piece[] = []
  if (morningStart >= dayStart) {
    const seed = hashSeed(dayStart, 4)
    const path = makePath(SITE.centre, DEPOT.centre, mulberry32(seed), 41_000 * (1 + (rng() - 0.5) * 0.01))
    const built = buildTrip({
      carId: CAR1,
      start: morningStart,
      path,
      drivingMs: 72 * MINUTE,
      stops: [
        { atDrivingMs: 16 * MINUTE, durMs: 3 * MINUTE },
        { atDrivingMs: 51 * MINUTE, durMs: 8 * MINUTE },
      ],
      intervalMs: TODAY_INTERVAL_MS,
      seed,
    })
    car1.push(parkAt(path, false, dayStart, morningStart))
    car1.push({ kind: 'trip', trip: built.trip, fixes: built.fixes })
    car1.push(parkAt(path, true, morningEnd, liveStart))
  } else {
    car1.push(parkAt(outward, false, dayStart, liveStart))
  }
  car1.push({ kind: 'live', start: liveStart, driver })

  // Car 02: Supplier yard -> Site, 75 minutes, with a 6 minute gap 33 minutes in.
  const car2: Piece[] = []
  const tripEnd = Math.min(dayStart + 13 * HOUR + 40 * MINUTE, anchor - 20 * MINUTE)
  const tripStart = tripEnd - 75 * MINUTE
  if (tripStart >= dayStart) {
    const seed = hashSeed(dayStart, 5)
    const path = makePath(SUPPLIER.centre, SITE.centre, mulberry32(seed), 38_000 * (1 + (rng() - 0.5) * 0.01))
    const built = buildTrip({
      carId: CAR2,
      start: tripStart,
      path,
      drivingMs: 75 * MINUTE,
      stops: [],
      intervalMs: TODAY_INTERVAL_MS,
      gap: { offsetMs: 33 * MINUTE, durMs: 6 * MINUTE },
      seed,
    })
    car2.push(parkAt(path, false, dayStart, tripStart))
    car2.push({ kind: 'trip', trip: built.trip, fixes: built.fixes })
    car2.push(parkAt(path, true, tripEnd, Infinity))
    if (built.gap) gaps.push(built.gap)
  } else {
    car2.push({ kind: 'park', from: dayStart, to: Infinity, lat: SITE.centre[0], lon: SITE.centre[1], course: 0 })
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
