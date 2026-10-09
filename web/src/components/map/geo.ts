import type { Geofence } from '../../data/types'

/** Ray-casting point-in-polygon. `ring` is [lon, lat] points; the ring may or may not repeat its first point. */
export function pointInPolygon(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The geofence containing the point. The work-site zone wins over other places when they overlap. */
export function geofenceAt(lon: number, lat: number, geofences: Geofence[]): Geofence | null {
  const hits = geofences.filter((g) => pointInPolygon(lon, lat, g.polygon))
  return hits.find((g) => g.kind === 'site') ?? hits[0] ?? null
}
