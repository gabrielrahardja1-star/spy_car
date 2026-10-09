// Polyline paths between places: a curvy line with jitter, and lookups along it.
import { bearingDeg, haversineM } from './util'

export interface Path {
  lat: number[]
  lon: number[]
  /** Cumulative length in metres at each vertex. */
  cum: number[]
  length: number
}

export function toPath(points: [number, number][]): Path {
  const lat: number[] = []
  const lon: number[] = []
  const cum: number[] = []
  let total = 0
  points.forEach(([la, lo], i) => {
    if (i > 0) total += haversineM(lat[i - 1], lon[i - 1], la, lo)
    lat.push(la)
    lon.push(lo)
    cum.push(total)
  })
  return { lat, lon, cum, length: total }
}

/** Position and heading at distance `s` metres along the path (clamped to its ends). */
export function pointAt(path: Path, s: number): { lat: number; lon: number; course: number } {
  const last = path.cum.length - 1
  const d = Math.min(Math.max(s, 0), path.length)
  let lo = 0
  let hi = last
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (path.cum[mid] <= d) lo = mid
    else hi = mid
  }
  const seg = path.cum[hi] - path.cum[lo]
  const f = seg > 0 ? (d - path.cum[lo]) / seg : 0
  return {
    lat: path.lat[lo] + (path.lat[hi] - path.lat[lo]) * f,
    lon: path.lon[lo] + (path.lon[hi] - path.lon[lo]) * f,
    course: bearingDeg(path.lat[lo], path.lon[lo], path.lat[hi], path.lon[hi]),
  }
}

/**
 * Curvy path from a to b ([lat, lon]) whose length is close to targetLenM.
 * Lateral wobble is tapered to zero at both ends so the path starts and ends exactly on the given points.
 */
export function makePath(a: [number, number], b: [number, number], rng: () => number, targetLenM: number): Path {
  const mx = 111320 * Math.cos((a[0] * Math.PI) / 180)
  const my = 110574
  const bx = (b[1] - a[1]) * mx
  const by = (b[0] - a[0]) * my
  const dist = Math.hypot(bx, by)
  const ux = bx / dist
  const uy = by / dist
  const n = Math.max(12, Math.ceil(dist / 300))
  const waves = 2 + Math.floor(rng() * 2)
  const p1 = rng() * 2 * Math.PI
  const p2 = rng() * 2 * Math.PI
  const jx = Array.from({ length: n + 1 }, () => (rng() - 0.5) * 160)
  const jy = Array.from({ length: n + 1 }, () => (rng() - 0.5) * 160)

  const build = (amp: number): Path => {
    const pts: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const edge = Math.min(1, t / 0.1, (1 - t) / 0.1)
      const env = edge * edge * (3 - 2 * edge)
      const off = amp * env * (Math.sin(2 * Math.PI * waves * t + p1) + 0.35 * Math.sin(2 * Math.PI * (2 * waves + 1) * t + p2))
      const x = ux * dist * t - uy * off + jx[i] * env
      const y = uy * dist * t + ux * off + jy[i] * env
      pts.push([a[0] + y / my, a[1] + x / mx])
    }
    return toPath(pts)
  }

  let lo = 0
  let hi = dist * 0.6
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (build(mid).length < targetLenM) lo = mid
    else hi = mid
  }
  return build((lo + hi) / 2)
}
