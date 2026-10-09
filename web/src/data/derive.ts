// OWNED BY: derive agent. Pure functions, no I/O, no Date.now (take `now` as an argument).
import { config, type Config } from '../config'
import { atLocalHour, dayBounds, formatClock, formatDuration } from './format'
import type { Car, CarStatus, LiveCar, Position, SignalGap, StripSegment, Stop, Summary, Trip } from './types'

export function knotsToKmh(knots: number): number {
  return knots * 1.852
}

/** Copy sorted by fixTime ascending; drops exact duplicates (same carId + fixTime). */
export function sortPositions(positions: Position[]): Position[] {
  const sorted = positions.slice().sort((a, b) => a.fixTime - b.fixTime)
  const seen = new Set<string>()
  const out: Position[] = []
  for (const p of sorted) {
    const key = `${p.carId}\u0000${p.fixTime}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function isMoving(p: Position, cfg: Config): boolean {
  return p.speedKmh > cfg.movingKmh || p.motion
}

/**
 * PLAN.md 5.3. No position or fix older than cfg.noSignalMs -> "nosignal"; else speed > movingKmh or motion -> "moving"; else "parked".
 * A fix exactly noSignalMs old is still fresh. A fix from the future (clock skew) counts as age 0.
 */
export function carStatus(position: Position | null, now: number, cfg: Config = config): CarStatus {
  if (!position) return 'nosignal'
  const age = Math.max(0, now - position.fixTime)
  if (age > cfg.noSignalMs) return 'nosignal'
  return isMoving(position, cfg) ? 'moving' : 'parked'
}

/**
 * Time since the car last moved, from its recent history (sorted or not). null if not currently parked
 * (moving, no signal, or no data).
 *
 * Choice: "the car last moved" is the first parked fix after the last moving fix, so the result is
 * `now - fixTime(first parked fix after the last moving fix)`. If it never moved in the data, the
 * first fix of the history is used as the start of the parked period.
 */
export function parkedForMs(positions: Position[], now: number, cfg: Config = config): number | null {
  const sorted = sortPositions(positions)
  if (sorted.length === 0) return null
  if (carStatus(sorted[sorted.length - 1], now, cfg) !== 'parked') return null
  let lastMoving = -1
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (isMoving(sorted[i], cfg)) {
      lastMoving = i
      break
    }
  }
  // The latest fix is parked, so lastMoving < length - 1 and the next index exists.
  const start = sorted[lastMoving + 1].fixTime
  return Math.max(0, now - start)
}

/** Builds the Live-map view of one car. `recent` is that car's recent positions (any order), used for parkedFor. */
export function toLiveCar(car: Car, recent: Position[], now: number, cfg: Config = config): LiveCar {
  const sorted = sortPositions(recent)
  const position = sorted.length > 0 ? sorted[sorted.length - 1] : null
  const status = carStatus(position, now, cfg)
  return {
    car,
    position,
    status,
    lastSeenMs: position ? Math.max(0, now - position.fixTime) : null,
    parkedForMs: status === 'parked' ? parkedForMs(sorted, now, cfg) : null,
  }
}

/**
 * Signal gaps: breaks between consecutive fixes longer than cfg.noSignalMs where the car was on a trip
 * (gap overlaps a trip's [startTime, endTime ?? lastFix]). Positions may be unsorted.
 * Only gaps between two real fixes are reported; the open "no fix since" tail is not a gap.
 */
export function findSignalGaps(carId: string, positions: Position[], trips: Trip[], cfg: Config = config): SignalGap[] {
  const sorted = sortPositions(positions.filter((p) => p.carId === carId))
  if (sorted.length < 2) return []
  const lastFix = sorted[sorted.length - 1].fixTime
  const windows = trips
    .filter((t) => t.carId === carId)
    .map((t) => ({ start: t.startTime, end: t.endTime ?? lastFix }))
  const gaps: SignalGap[] = []
  for (let i = 1; i < sorted.length; i++) {
    const startTime = sorted[i - 1].fixTime
    const endTime = sorted[i].fixTime
    const durationMs = endTime - startTime
    if (durationMs <= cfg.noSignalMs) continue
    if (windows.some((w) => startTime < w.end && endTime > w.start)) gaps.push({ carId, startTime, endTime, durationMs })
  }
  return gaps
}

/** Totals for one car from its trips. Single source of truth so Dashboard and Route history agree. */
export function summarizeTrips(carId: string, trips: Trip[]): Summary {
  const s: Summary = { carId, distanceM: 0, drivingMs: 0, tripCount: 0, stopCount: 0, inProgressCount: 0 }
  for (const t of trips) {
    if (t.carId !== carId) continue
    s.distanceM += t.distanceM
    s.drivingMs += t.drivingMs
    s.tripCount += 1
    s.stopCount += t.stops.length
    if (t.endTime === null) s.inProgressCount += 1
  }
  return s
}

/** Metres driven per local day for the given days (each entry is a day start). Counts a trip on the day it started. */
export function distancePerDay(trips: Trip[], dayStarts: number[], tz: string = config.timezone): number[] {
  return dayStarts.map((ds) => {
    const { start, end } = dayBounds(ds, tz)
    let sum = 0
    for (const t of trips) if (t.startTime >= start && t.startTime < end) sum += t.distanceM
    return sum
  })
}

/**
 * Hour-by-hour strip for one car on one day, covering [dayStart + workdayStartHour, dayStart + workdayEndHour)
 * in local wall-clock hours.
 * Moving = inside a trip and not in a stop; Parked = otherwise; Nosignal = inside a gap (wins over the rest).
 * Time after `now` is not drawn (segments stop at now). widthPct is relative to the full workday span.
 *
 * Titles: "Moving 07:42 to 07:58"; "Parked 3 min" for moving/parked segments shorter than 10 min;
 * "to now" when the segment ends at `now`. No-signal segments always show their times ("No signal 12:58 to 13:04").
 */
export function buildHourStrip(args: {
  dayStart: number
  now: number
  trips: Trip[]
  gaps: SignalGap[]
  cfg?: Config
}): StripSegment[] {
  const { dayStart, now, trips, gaps } = args
  const cfg = args.cfg ?? config
  const tz = cfg.timezone
  const wStart = atLocalHour(dayStart, cfg.workdayStartHour, tz)
  const wEnd = atLocalHour(dayStart, cfg.workdayEndHour, tz)
  const span = wEnd - wStart
  const limit = Math.min(wEnd, now)
  if (span <= 0 || limit <= wStart) return []

  const stopsByTrip = trips.map((t) => t.stops)
  const cuts = new Set<number>([wStart, limit])
  const addCut = (x: number) => {
    if (x > wStart && x < limit) cuts.add(x)
  }
  trips.forEach((t, i) => {
    addCut(t.startTime)
    if (t.endTime !== null) addCut(t.endTime)
    for (const s of stopsByTrip[i]) {
      addCut(s.startTime)
      addCut(s.endTime)
    }
  })
  for (const g of gaps) {
    addCut(g.startTime)
    addCut(g.endTime)
  }
  const points = [...cuts].sort((a, b) => a - b)

  const kindAt = (m: number): CarStatus => {
    if (gaps.some((g) => g.startTime <= m && m < g.endTime)) return 'nosignal'
    const moving = trips.some(
      (t, i) =>
        t.startTime <= m &&
        (t.endTime === null || m < t.endTime) &&
        !stopsByTrip[i].some((s) => s.startTime <= m && m < s.endTime),
    )
    return moving ? 'moving' : 'parked'
  }

  const merged: { kind: CarStatus; start: number; end: number }[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const kind = kindAt((a + b) / 2)
    const last = merged[merged.length - 1]
    if (last && last.kind === kind) last.end = b
    else merged.push({ kind, start: a, end: b })
  }

  return merged.map((seg) => ({
    kind: seg.kind,
    startTime: seg.start,
    endTime: seg.end,
    widthPct: ((seg.end - seg.start) / span) * 100,
    title: segmentTitle(seg.kind, seg.start, seg.end, now, tz),
  }))
}

/**
 * The "no fix since" tail of a car that has no signal right now: from its last fix to `now`.
 * findSignalGaps never reports it (it is not a break between two fixes), but the hour strip must not draw
 * it as parked (PLAN.md 5.3). null when the car has a fresh fix. A car that never reported counts from time 0.
 */
export function openSignalGap(carId: string, position: Position | null, now: number, cfg: Config = config): SignalGap | null {
  if (carStatus(position, now, cfg) !== 'nosignal') return null
  const startTime = Math.min(position?.fixTime ?? 0, now)
  return { carId, startTime, endTime: now, durationMs: now - startTime }
}

/**
 * Plain-text version of a strip for screen readers: "Parked 06:00 to 07:42, Moving 07:42 to 07:58, ...".
 * `now` marks the open end ("to now"). No segments (before the workday starts) says so instead of staying silent.
 */
export function describeStrip(segments: StripSegment[], now: number, tz: string = config.timezone): string {
  if (segments.length === 0) return 'nothing to show yet'
  return segments
    .map((s) => {
      const label = s.kind === 'moving' ? 'Moving' : s.kind === 'parked' ? 'Parked' : 'No signal'
      return `${label} ${formatClock(s.startTime, tz)} to ${s.endTime >= now ? 'now' : formatClock(s.endTime, tz)}`
    })
    .join(', ')
}

function segmentTitle(kind: CarStatus, start: number, end: number, now: number, tz: string): string {
  const label = kind === 'moving' ? 'Moving' : kind === 'parked' ? 'Parked' : 'No signal'
  const dur = end - start
  if (kind !== 'nosignal' && dur < 10 * 60_000) return `${label} ${formatDuration(dur)}`
  return `${label} ${formatClock(start, tz)} to ${end >= now ? 'now' : formatClock(end, tz)}`
}

/** Stop list helper: all stops of the given trips flattened, oldest first. */
export function stopsOf(trips: Trip[]): Stop[] {
  return trips.flatMap((t) => t.stops).sort((a, b) => a.startTime - b.startTime)
}
