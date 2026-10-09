// Pure helpers for replaying a trip: where the car was at a given time, how far it had driven, where the stops
// sit on the scrubber. No React and no maplibre, so these stay testable without WebGL.
import type { Position, Trip } from '../../data/types'
import { distanceM, glideAngle, type LngLat } from './mapGeometry'

/** The car's state at one moment, interpolated between the two fixes around it. */
export interface PlaybackPoint {
  lon: number
  lat: number
  /** Degrees clockwise from north, turned the short way round between fixes. */
  course: number
  speedKmh: number
}

export interface TimeSpan {
  start: number
  end: number
}

interface Prepared {
  /** The route sorted by fixTime. The same array when it was already in order. */
  fixes: Position[]
  /** Metres driven at each fix, along the straight lines between fixes. */
  cum: number[]
}

// Routes are treated as immutable, so the sort and the distances are worked out once per array, not once per frame.
const prepared = new WeakMap<Position[], Prepared>()

function prepare(route: Position[]): Prepared {
  const known = prepared.get(route)
  if (known) return known
  // Trackers buffer fixes through a signal gap and send them late (PLAN.md 5.2), so order is not guaranteed.
  const inOrder = route.every((f, i) => i === 0 || route[i - 1].fixTime <= f.fixTime)
  const fixes = inOrder ? route : [...route].sort((a, b) => a.fixTime - b.fixTime)
  const cum = [0]
  for (let i = 1; i < fixes.length; i++) {
    cum.push(cum[i - 1] + distanceM([fixes[i - 1].lon, fixes[i - 1].lat], [fixes[i].lon, fixes[i].lat]))
  }
  const result = { fixes, cum }
  prepared.set(route, result)
  return result
}

/** The route in time order. */
export function sortFixes(route: Position[]): Position[] {
  return prepare(route).fixes
}

/** Index of the last fix at or before `t`; -1 if `t` is before the first. Fixes must be sorted. */
function lastAtOrBefore(fixes: Position[], t: number): number {
  let lo = 0
  let hi = fixes.length - 1
  if (t < fixes[0].fixTime) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (fixes[mid].fixTime <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

const pointOf = (f: Position): PlaybackPoint => ({ lon: f.lon, lat: f.lat, course: f.course, speedKmh: f.speedKmh })

/** Where the route is at `t`, as the index of the fix before it and how far (0..1) towards the next. Null for an empty route. */
function locate(route: Position[], t: number): { p: Prepared; i: number; k: number } | null {
  const p = prepare(route)
  const n = p.fixes.length
  if (n === 0) return null
  if (t <= p.fixes[0].fixTime) return { p, i: 0, k: 0 }
  if (t >= p.fixes[n - 1].fixTime) return { p, i: n - 1, k: 0 }
  const i = lastAtOrBefore(p.fixes, t)
  // fixes[i + 1] is later than t and fixes[i] is not, so the span is never zero.
  return { p, i, k: (t - p.fixes[i].fixTime) / (p.fixes[i + 1].fixTime - p.fixes[i].fixTime) }
}

/**
 * Position, heading and speed at time `t`. Before the first fix it is the first, after the last it is the last.
 * Across a signal gap the car moves in a straight line between the fixes either side (we do not know the road).
 */
export function positionAt(route: Position[], t: number): PlaybackPoint | null {
  const at = locate(route, t)
  if (!at) return null
  const a = at.p.fixes[at.i]
  if (at.k === 0) return pointOf(a)
  const b = at.p.fixes[at.i + 1]
  const lerp = (x: number, y: number) => x + (y - x) * at.k
  return { lon: lerp(a.lon, b.lon), lat: lerp(a.lat, b.lat), course: glideAngle(a.course, b.course, at.k), speedKmh: lerp(a.speedKmh, b.speedKmh) }
}

/**
 * Metres driven by `t`, summed along the route. With `totalM` the result is scaled so the whole route equals
 * `totalM` (the trip's own distance), which keeps the end of the replay in line with the number on the trip card.
 */
export function distanceAlong(route: Position[], t: number, totalM?: number): number {
  const at = locate(route, t)
  if (!at) return 0
  const { cum } = at.p
  const total = cum[cum.length - 1]
  const driven = at.k === 0 ? cum[at.i] : cum[at.i] + (cum[at.i + 1] - cum[at.i]) * at.k
  return totalM !== undefined && total > 0 ? (driven / total) * totalM : driven
}

/** The whole route as map coordinates, in time order. */
export function routeCoordinates(route: Position[]): LngLat[] {
  return prepare(route).fixes.map((f): LngLat => [f.lon, f.lat])
}

/** The part of the route already driven at `t`: every fix up to then, ending exactly at the car. */
export function drivenCoordinates(route: Position[], t: number): LngLat[] {
  const at = locate(route, t)
  if (!at) return []
  const coords = at.p.fixes.slice(0, at.i + 1).map((f): LngLat => [f.lon, f.lat])
  if (at.k > 0) {
    const head = positionAt(route, t)
    if (head) coords.push([head.lon, head.lat])
  }
  return coords
}

/**
 * The time range a replay covers. A finished trip runs from its start to its end; one still under way runs to the
 * newest fix we have (there is no later point to show).
 */
export function tripSpan(trip: Pick<Trip, 'startTime' | 'endTime'>, route: Position[]): TimeSpan {
  if (trip.endTime !== null) return { start: trip.startTime, end: Math.max(trip.startTime, trip.endTime) }
  const { fixes } = prepare(route)
  const last = fixes[fixes.length - 1]
  return { start: trip.startTime, end: Math.max(trip.startTime, last?.fixTime ?? trip.startTime) }
}

/**
 * Where each stop begins on the scrubber, as a share (0..1) of the trip's span. `end` defaults to the trip's end;
 * pass the span's end for a trip still under way.
 */
export function stopTicks(trip: Trip, end: number | null = trip.endTime): number[] {
  const to = end ?? Math.max(trip.startTime, ...trip.stops.map((s) => s.endTime))
  const length = to - trip.startTime
  if (length <= 0) return []
  return trip.stops
    .map((s) => Math.min(1, Math.max(0, (s.startTime - trip.startTime) / length)))
    .sort((a, b) => a - b)
}
