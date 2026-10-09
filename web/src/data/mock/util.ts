// Small helpers private to the mock: seeded PRNG, geometry, local-day maths.
import { config } from '../../config'
import type { Position } from '../types'

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE

/** Deterministic PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mixes integers (epoch ms included) into one 32-bit seed. */
export function hashSeed(...parts: number[]): number {
  let h = 2166136261
  for (const p of parts) {
    h = Math.imul(h ^ (p % 4294967296 | 0), 16777619)
    h = Math.imul(h ^ (Math.floor(p / 4294967296) | 0), 16777619)
  }
  return h >>> 0
}

const EARTH_R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Initial bearing in degrees, 0 = north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = rad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Ray casting. Ring is [lon, lat] points. */
export function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const round = (v: number, digits: number) => {
  const m = 10 ** digits
  return Math.round(v * m) / m
}

export function makeFix(carId: string, fixTime: number, lat: number, lon: number, speedKmh: number, course: number): Position {
  const speed = round(speedKmh, 1)
  return {
    carId,
    fixTime,
    lat: round(lat, 6),
    lon: round(lon, 6),
    speedKmh: speed,
    course: Math.round(course) % 360,
    motion: speed > config.movingKmh,
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function localParts(ms: number, tz: string): Record<string, number> {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(tz, f)
  }
  const out: Record<string, number> = {}
  for (const part of f.formatToParts(ms)) if (part.type !== 'literal') out[part.type] = Number(part.value)
  return out
}

/** UTC ms of local midnight for the local day containing `ms`. */
export function localDayStart(ms: number, tz: string): number {
  const p = localParts(ms, tz)
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / SECOND) * SECOND
  return Date.UTC(p.year, p.month - 1, p.day) - offset
}

/** 0 = Sunday, for the local day containing `ms`. */
export function localWeekday(ms: number, tz: string): number {
  const p = localParts(ms, tz)
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

/** Index of the first element with key(x) >= value in an ascending array. */
export function lowerBound<T>(arr: T[], value: number, key: (x: T) => number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(arr[mid]) < value) lo = mid + 1
    else hi = mid
  }
  return lo
}
