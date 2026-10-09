// Small geometry helpers for the Traccar data source. Copies of the few lines it needs from components/map/geo.ts
// and data/mock/util.ts, so the data layer does not import from components.
import type { Geofence, Position } from '../types'

const EARTH_R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Length in metres of the path through the fixes, in the order given. */
export function pathLengthM(fixes: Position[]): number {
  let sum = 0
  for (let i = 1; i < fixes.length; i++) sum += haversineM(fixes[i - 1].lat, fixes[i - 1].lon, fixes[i].lat, fixes[i].lon)
  return sum
}

/** Ray casting. `ring` is [lon, lat] points. */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Name of the geofence containing the point (the site zone wins over other places), or null. */
export function geofenceNameAt(lat: number, lon: number, geofences: Geofence[]): string | null {
  const hits = geofences.filter((g) => pointInRing(lon, lat, g.polygon))
  return (hits.find((g) => g.kind === 'site') ?? hits[0])?.name ?? null
}
