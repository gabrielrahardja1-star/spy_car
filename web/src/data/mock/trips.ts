// Turns a path plus a driving plan into a Trip with its position fixes, and drives the endless loop.
import type { Position, SignalGap, Stop, Trip } from '../types'
import { placeAt } from './places'
import { pointAt, type Path } from './route'
import { haversineM, makeFix, mulberry32, SECOND } from './util'

export interface StopPlan {
  /** Driving time elapsed when the stop begins. */
  atDrivingMs: number
  durMs: number
}

export interface TripPlan {
  carId: string
  start: number
  path: Path
  /** Whole seconds. Excludes stops. */
  drivingMs: number
  stops: StopPlan[]
  intervalMs: number
  /** Signal gap, as an offset from trip start. Rounded to the fix interval. Must not overlap a stop. */
  gap?: { offsetMs: number; durMs: number }
  seed: number
}

export interface BuiltTrip {
  trip: Trip
  fixes: Position[]
  gap: SignalGap | null
}

export function tripId(carId: string, start: number): string {
  return `${carId}-${start}`
}

/** Distance, max speed and place labels from a fix list. Shared by finished and in-progress trips. */
export function measure(fixes: Position[]): { distanceM: number; maxSpeedKmh: number } {
  let distanceM = 0
  let maxSpeedKmh = 0
  fixes.forEach((f, i) => {
    if (i > 0) distanceM += haversineM(fixes[i - 1].lat, fixes[i - 1].lon, f.lat, f.lon)
    maxSpeedKmh = Math.max(maxSpeedKmh, f.speedKmh)
  })
  return { distanceM: Math.round(distanceM), maxSpeedKmh }
}

export function buildTrip(plan: TripPlan): BuiltTrip {
  const { carId, start, path, intervalMs } = plan
  const rng = mulberry32(plan.seed)
  const drivingS = Math.round(plan.drivingMs / SECOND)
  const phase1 = rng() * 2 * Math.PI
  const phase2 = rng() * 2 * Math.PI

  // Relative speed shape per second of driving, easing in and out. Its integral is scaled to the path length.
  const shape = new Float64Array(drivingS + 1)
  const cumShape = new Float64Array(drivingS + 1)
  for (let j = 0; j <= drivingS; j++) {
    const edge = Math.min(j, drivingS - j)
    const ramp = Math.min(1, 0.25 + (0.75 * edge) / 45)
    shape[j] = ramp * (1 + 0.2 * Math.sin((2 * Math.PI * j) / 420 + phase1) + 0.1 * Math.sin((2 * Math.PI * j) / 97 + phase2))
    if (j > 0) cumShape[j] = cumShape[j - 1] + (shape[j - 1] + shape[j]) / 2
  }
  const total = cumShape[drivingS]
  const interp = (arr: Float64Array, u: number) => {
    const c = Math.min(Math.max(u, 0), drivingS)
    const j = Math.min(Math.floor(c), drivingS - 1)
    return arr[j] + (arr[j + 1] - arr[j]) * (c - j)
  }
  const arcAt = (drivingMs: number) => (path.length * interp(cumShape, drivingMs / SECOND)) / total
  const kmhAt = (drivingMs: number) => ((path.length * interp(shape, drivingMs / SECOND)) / total) * 3.6

  // Stop windows on the elapsed-time axis.
  const stops = plan.stops.slice().sort((a, b) => a.atDrivingMs - b.atDrivingMs)
  let shift = 0
  const windows = stops.map((s) => {
    const from = s.atDrivingMs + shift
    shift += s.durMs
    return { from, to: from + s.durMs, atDrivingMs: s.atDrivingMs }
  })
  const elapsedMs = plan.drivingMs + shift
  const stoppedAt = (e: number) => windows.some((w) => e >= w.from && e < w.to)
  const drivenAt = (e: number) => {
    let driven = e
    for (const w of windows) if (e > w.from) driven -= Math.min(e, w.to) - w.from
    return driven
  }

  let gapFrom = -1
  let gapTo = -1
  if (plan.gap) {
    gapFrom = Math.round(plan.gap.offsetMs / intervalMs) * intervalMs
    gapTo = gapFrom + Math.ceil(plan.gap.durMs / intervalMs) * intervalMs
  }

  const offsets: number[] = []
  for (let e = 0; e <= elapsedMs; e += intervalMs) offsets.push(e)
  if (offsets[offsets.length - 1] < elapsedMs) offsets.push(elapsedMs)

  const fixes: Position[] = []
  for (const e of offsets) {
    if (e > gapFrom && e < gapTo) continue
    const driven = drivenAt(e)
    const pt = pointAt(path, arcAt(driven))
    const speed = stoppedAt(e) || e === elapsedMs ? 0 : kmhAt(driven)
    fixes.push(makeFix(carId, start + e, pt.lat, pt.lon, speed, pt.course))
  }

  const tripStops: Stop[] = windows.map((w) => {
    const pt = pointAt(path, arcAt(w.atDrivingMs))
    return {
      carId,
      startTime: start + w.from,
      endTime: start + w.to,
      durationMs: w.to - w.from,
      lat: Number(pt.lat.toFixed(6)),
      lon: Number(pt.lon.toFixed(6)),
      place: placeAt(pt.lat, pt.lon),
    }
  })

  const first = fixes[0]
  const last = fixes[fixes.length - 1]
  const { distanceM, maxSpeedKmh } = measure(fixes)
  const trip: Trip = {
    id: tripId(carId, start),
    carId,
    startTime: start,
    endTime: start + elapsedMs,
    startPlace: placeAt(first.lat, first.lon),
    endPlace: placeAt(last.lat, last.lon),
    distanceM,
    drivingMs: plan.drivingMs,
    maxSpeedKmh,
    stops: tripStops,
  }
  const gap: SignalGap | null =
    plan.gap && gapTo > gapFrom
      ? { carId, startTime: start + gapFrom, endTime: start + gapTo, durationMs: gapTo - gapFrom }
      : null
  return { trip, fixes, gap }
}

export interface LoopDriver {
  startTime: number
  /** Grid fixes (one per step) from the start up to `t`. */
  fixesUpTo(t: number): Position[]
  /** Interpolated position at any time `t >= startTime`, stamped with `t`. */
  positionAt(t: number): Position
}

/** A car that circles a closed path forever at roughly `baseKmh`. */
export function createLoopDriver(carId: string, path: Path, startTime: number, stepMs: number, baseKmh: number, seed: number): LoopDriver {
  const rng = mulberry32(seed)
  const phase1 = rng() * 2 * Math.PI
  const phase2 = rng() * 2 * Math.PI
  const speeds: number[] = []
  const cum: number[] = [0]
  const grid: Position[] = []

  const ensure = (k: number) => {
    while (speeds.length <= k) {
      const i = speeds.length
      const ramp = Math.min(1, 0.3 + (0.7 * i) / 6)
      const v = baseKmh * ramp * (1 + 0.14 * Math.sin((2 * Math.PI * i) / 53 + phase1) + 0.07 * Math.sin((2 * Math.PI * i) / 17 + phase2))
      speeds.push(v)
      cum.push(cum[i] + (v / 3.6) * (stepMs / SECOND))
    }
  }
  const fixAt = (t: number, s: number, v: number) => {
    const pt = pointAt(path, s % path.length)
    return makeFix(carId, t, pt.lat, pt.lon, v, pt.course)
  }

  return {
    startTime,
    fixesUpTo(t) {
      const k = Math.floor((t - startTime) / stepMs)
      if (k < 0) return []
      ensure(k)
      while (grid.length <= k) grid.push(fixAt(startTime + grid.length * stepMs, cum[grid.length], speeds[grid.length]))
      return grid.slice(0, k + 1)
    },
    positionAt(t) {
      const k = Math.max(0, Math.floor((t - startTime) / stepMs))
      ensure(k)
      const frac = Math.min(1, Math.max(0, (t - startTime - k * stepMs) / stepMs))
      return fixAt(t, cum[k] + (cum[k + 1] - cum[k]) * frac, speeds[k])
    },
  }
}
