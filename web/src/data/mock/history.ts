// Seeded history for the 30 local days before today: shifts of haul cycles between a start point and Area 2.
import type { Position, SignalGap, Trip } from '../types'
import { CONVEYOR, CWP, KLINIK, VENTILASI, type StartPoint } from './places'
import { roadPath } from './route'
import { DUMP_MS, LOAD_MS } from './today'
import { buildTrip, type StopPlan } from './trips'
import { HOUR, hashSeed, localDayStart, localWeekday, MINUTE, mulberry32 } from './util'

/** Whole days generated before today (one spare so a 30-day range starting mid-day is covered). */
export const HISTORY_DAYS = 31
const HISTORY_INTERVAL_MS = 30_000
/** Runs at least this long can have a short wait (giving way, a crossing) or a signal gap. */
const LONG_RUN_MS = 6 * MINUTE

export interface History {
  /** Oldest first. */
  trips: Trip[]
  /** Per car, ascending by fixTime. */
  fixes: Map<string, Position[]>
  gaps: SignalGap[]
}

/** Idle chance per weekday (0 = Sunday). */
const IDLE_CHANCE = [0.7, 0.1, 0.07, 0.07, 0.1, 0.12, 0.4]
/** Start points each truck is sent to, with their chance. */
const ASSIGNMENTS: [StartPoint, number][][] = [
  [[CWP, 0.6], [CONVEYOR, 0.4]],
  [[VENTILASI, 0.55], [KLINIK, 0.45]],
]

function pickStart(rng: () => number, carIdx: number): StartPoint {
  const options = ASSIGNMENTS[carIdx % ASSIGNMENTS.length]
  let roll = rng()
  for (const [pit, chance] of options) {
    if (roll < chance) return pit
    roll -= chance
  }
  return options[options.length - 1][0]
}

export function buildHistory(todayStart: number, tz: string, carIds: string[]): History {
  const days: { start: number; end: number }[] = []
  let end = todayStart
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const start = localDayStart(end - 1, tz)
    days.push({ start, end })
    end = start
  }
  days.reverse()

  const history: History = { trips: [], fixes: new Map(carIds.map((id) => [id, []])), gaps: [] }
  for (const day of days) {
    const weekday = localWeekday(day.start + 12 * HOUR, tz)
    const weekend = weekday === 0 || weekday === 6
    carIds.forEach((carId, carIdx) => {
      const rng = mulberry32(hashSeed(day.start, carIdx, 7))
      if (rng() < IDLE_CHANCE[weekday]) return
      const from = pickStart(rng, carIdx)
      const legs = [roadPath(from.road, true), roadPath(from.road, false)]
      let t = day.start + (6 + rng() * 0.75) * HOUR
      const shiftEnd = t + (weekend ? 3 + rng() * 3 : 7 + rng() * 4) * HOUR
      const breakAt = t + (shiftEnd - t) * (0.4 + rng() * 0.2)
      let tookBreak = false
      for (let i = 0; t < shiftEnd; i++) {
        const loaded = i % 2 === 0
        t += loaded ? LOAD_MS + rng() * 4 * MINUTE : DUMP_MS + rng() * 3 * MINUTE
        const kmh = loaded ? 15 + rng() * 5 : 25 + rng() * 7
        const path = legs[loaded ? 0 : 1]
        const drivingMs = Math.round((path.length / 1000 / kmh) * 3600) * 1000
        const stops = pickStops(rng, drivingMs)
        const elapsed = drivingMs + stops.reduce((sum, s) => sum + s.durMs, 0)
        if (t + elapsed > day.end - 30 * MINUTE) break
        const seed = hashSeed(day.start, carIdx, i, 11)
        const built = buildTrip({
          carId,
          start: Math.round(t / 1000) * 1000,
          path,
          drivingMs,
          stops,
          intervalMs: HISTORY_INTERVAL_MS,
          gap: pickGap(rng, drivingMs, stops),
          seed,
        })
        history.trips.push(built.trip)
        history.fixes.get(carId)?.push(...built.fixes)
        if (built.gap) history.gaps.push(built.gap)
        t += elapsed
        // Meal break at the start point, after an empty run.
        if (!loaded && !tookBreak && t >= breakAt) {
          t += (40 + rng() * 30) * MINUTE
          tookBreak = true
        }
      }
    })
  }
  return history
}

function pickStops(rng: () => number, drivingMs: number): StopPlan[] {
  // A short wait on a long run, under 5 minutes so Traccar keeps it inside the trip.
  if (drivingMs < LONG_RUN_MS || rng() >= 0.3) return []
  const atDrivingMs = Math.round((drivingMs * (0.25 + rng() * 0.5)) / 1000) * 1000
  return [{ atDrivingMs, durMs: Math.round(2 + rng() * 2) * MINUTE }]
}

/** Occasionally a 6 minute signal gap early in a long run (weak coverage on the haul road), kept clear of stops. */
function pickGap(rng: () => number, drivingMs: number, stops: StopPlan[]): { offsetMs: number; durMs: number } | undefined {
  if (drivingMs < 8 * MINUTE || rng() >= 0.08) return undefined
  const durMs = 6 * MINUTE
  const drivingOffset = drivingMs * (0.1 + rng() * 0.1)
  // Stops before the gap push it later on the elapsed axis; skip the gap if it would touch one.
  const earlier = stops.filter((s) => s.atDrivingMs < drivingOffset)
  const offsetMs = drivingOffset + earlier.reduce((sum, s) => sum + s.durMs, 0)
  const clash = stops.some((s) => {
    const from = s.atDrivingMs + stops.filter((o) => o.atDrivingMs < s.atDrivingMs).reduce((sum, o) => sum + o.durMs, 0)
    return from < offsetMs + durMs + HISTORY_INTERVAL_MS && from + s.durMs > offsetMs - HISTORY_INTERVAL_MS
  })
  return clash ? undefined : { offsetMs, durMs }
}
