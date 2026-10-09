// Seeded history for the 30 local days before today.
import type { Position, SignalGap, Trip } from '../types'
import { PLACES, SITE, WAYPOINTS, type PlaceDef } from './places'
import { makePath } from './route'
import { buildTrip, type StopPlan } from './trips'
import { haversineM, HOUR, hashSeed, localDayStart, localWeekday, MINUTE, mulberry32 } from './util'

/** Whole days generated before today (one spare so a 30-day range starting mid-day is covered). */
export const HISTORY_DAYS = 31
const HISTORY_INTERVAL_MS = 30_000
/** Most a car drives in one day (a leg that would pass this is skipped). The two cars differ a little. */
const DAILY_BUDGET_M = [110_000, 100_000]
/** A leg shorter than this is a local hop: slower town driving, shorter waits, fewer stops. */
const SHORT_LEG_M = 15_000

export interface History {
  /** Oldest first. */
  trips: Trip[]
  /** Per car, ascending by fixTime. */
  fixes: Map<string, Position[]>
  gaps: SignalGap[]
}

/** Idle chance per weekday (0 = Sunday). */
const IDLE_CHANCE = [0.7, 0.1, 0.07, 0.07, 0.1, 0.12, 0.4]

/** A place a car can be at the end of a leg: a geofence or a nearby stop-off. */
interface Node {
  centre: [number, number]
  /** Waypoints return to this place; geofences have none. */
  home: PlaceDef | null
}

const NODES: Node[] = [
  ...PLACES.map((p): Node => ({ centre: p.centre, home: null })),
  ...WAYPOINTS.map((w): Node => ({ centre: w.centre, home: w.near })),
]
const nodeOf = (p: PlaceDef) => NODES.find((n) => n.centre === p.centre) as Node

/** Where a car might go next, most likely first. Roughly: errands near a place, then back to a place. */
function candidates(rng: () => number, from: Node): Node[] {
  const places = NODES.filter((n) => n.home === null && n !== from)
  for (let i = places.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[places[i], places[j]] = [places[j], places[i]]
  }
  const shuffled = places
  if (from.home) {
    const home = nodeOf(from.home)
    return rng() < 0.75 ? [home, ...shuffled.filter((n) => n !== home)] : [...shuffled, home]
  }
  if (rng() < 0.3) {
    const near = NODES.filter((n) => n.home && n.home.centre === from.centre)
    if (near.length > 0) return [near[Math.floor(rng() * near.length)], ...shuffled]
  }
  return shuffled
}

function legsWanted(rng: () => number, weekday: number): number {
  const roll = rng()
  if (weekday === 0 || weekday === 6) return roll < 0.6 ? 1 : 2
  return roll < 0.12 ? 1 : roll < 0.45 ? 2 : roll < 0.8 ? 3 : 4
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
    carIds.forEach((carId, carIdx) => {
      const rng = mulberry32(hashSeed(day.start, carIdx, 7))
      if (rng() < IDLE_CHANCE[weekday]) return
      const budget = DAILY_BUDGET_M[carIdx % DAILY_BUDGET_M.length]
      let node: Node = rng() < 0.5 ? nodeOf(SITE) : NODES[Math.floor(rng() * PLACES.length)]
      let t = day.start + (6 + rng() * 2.5) * HOUR
      const wanted = legsWanted(rng, weekday)
      let distance = 0
      for (let i = 0; i < wanted; i++) {
        let dest: Node | null = null
        let length = 0
        for (const c of candidates(rng, node)) {
          const straight = haversineM(node.centre[0], node.centre[1], c.centre[0], c.centre[1])
          const l = straight * (1.2 + rng() * 0.25)
          if (distance + l <= budget) {
            dest = c
            length = l
            break
          }
        }
        if (!dest) break
        const kmh = length < SHORT_LEG_M ? 28 + rng() * 10 : 36 + rng() * 10
        const drivingMs = Math.round((length / 1000 / kmh) * 3600) * 1000
        const stops = pickStops(rng, drivingMs)
        const elapsed = drivingMs + stops.reduce((sum, s) => sum + s.durMs, 0)
        if (t + elapsed > day.end - 30 * MINUTE) break
        const seed = hashSeed(day.start, carIdx, i, 11)
        const gap = pickGap(rng, drivingMs, stops)
        const built = buildTrip({
          carId,
          start: Math.round(t / 1000) * 1000,
          path: makePath(node.centre, dest.centre, mulberry32(seed), length),
          drivingMs,
          stops,
          intervalMs: HISTORY_INTERVAL_MS,
          gap,
          seed,
        })
        history.trips.push(built.trip)
        history.fixes.get(carId)?.push(...built.fixes)
        if (built.gap) history.gaps.push(built.gap)
        distance += built.trip.distanceM
        const errand = dest.home !== null
        node = dest
        t += elapsed + (errand ? 8 + rng() * 27 : 30 + rng() * 120) * MINUTE
      }
    })
  }
  return history
}

function pickStops(rng: () => number, drivingMs: number): StopPlan[] {
  const roll = rng()
  // Local hops get at most one short stop; the others get up to two.
  const long = drivingMs >= 25 * MINUTE
  const count = drivingMs < 12 * MINUTE || roll < 0.35 ? 0 : roll < 0.8 || !long ? 1 : 2
  const maxMin = Math.max(2, Math.min(12, Math.round(drivingMs / MINUTE / 3)))
  const stops: StopPlan[] = []
  for (let i = 0; i < count; i++) {
    const frac = count === 1 ? 0.25 + rng() * 0.5 : i === 0 ? 0.2 + rng() * 0.25 : 0.55 + rng() * 0.25
    stops.push({ atDrivingMs: Math.round((drivingMs * frac) / 1000) * 1000, durMs: Math.round(2 + rng() * (maxMin - 2)) * MINUTE })
  }
  return stops
}

/** Occasionally a 6 to 15 minute signal gap on a long trip, kept clear of stops. */
function pickGap(rng: () => number, drivingMs: number, stops: StopPlan[]): { offsetMs: number; durMs: number } | undefined {
  if (drivingMs < 40 * MINUTE || rng() >= 0.1) return undefined
  const durMs = Math.round(6 + rng() * 9) * MINUTE
  const drivingOffset = drivingMs * (0.3 + rng() * 0.3)
  // Stops before the gap push it later on the elapsed axis; skip the gap if it would touch one.
  const earlier = stops.filter((s) => s.atDrivingMs < drivingOffset)
  const offsetMs = drivingOffset + earlier.reduce((sum, s) => sum + s.durMs, 0)
  const clash = stops.some((s) => {
    const from = s.atDrivingMs + stops.filter((o) => o.atDrivingMs < s.atDrivingMs).reduce((sum, o) => sum + o.durMs, 0)
    return from < offsetMs + durMs + HISTORY_INTERVAL_MS && from + s.durMs > offsetMs - HISTORY_INTERVAL_MS
  })
  return clash ? undefined : { offsetMs, durMs }
}
