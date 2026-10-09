// Pure geometry helpers for the Live map. No maplibre import, so these stay testable without WebGL.
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson'
import type { CarStatus, Geofence, Position } from '../../data/types'

export type LngLat = [number, number]

/** One car on the map, with the text its callout shows. */
export interface MapPin {
  id: string
  /** Zero-based car order; the badge shows index + 1 as "01". */
  index: number
  name: string
  status: CarStatus
  /** Second callout line, e.g. "42 km/h · 4 s ago". */
  detail: string
  /** Latest fix, or null if the car has never reported. */
  position: LngLat | null
  fixTime: number | null
  /** Heading in degrees clockwise from north, from the latest fix. */
  course: number | null
}

/** Mean of the ring's vertices (ignoring a repeated closing point). Good enough for label placement. */
export function centroid(ring: LngLat[]): LngLat {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
  const n = pts.length || 1
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
}

/** Where a zone's name goes: centred on the southern edge, like the design's "SITE ZONE" at the bottom of the outline. */
export function southEdge(ring: LngLat[]): LngLat {
  return [centroid(ring)[0], Math.min(...ring.map((p) => p[1]))]
}

/** [southwest, northeast] box around the points, or null for none. */
export function boundsOf(points: LngLat[]): [LngLat, LngLat] | null {
  if (points.length === 0) return null
  const lons = points.map((p) => p[0])
  const lats = points.map((p) => p[1])
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ]
}

/** Straight-line interpolation, t clamped to 0..1. Fine over the few metres between two pings. */
export function glideAt(from: LngLat, to: LngLat, t: number): LngLat {
  const k = Math.min(1, Math.max(0, t))
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k]
}

/** Turn between two headings the short way round (359 -> 1 is 2 degrees, not 358), t clamped to 0..1. Result is 0..360. */
export function glideAngle(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t))
  const delta = ((((to - from) % 360) + 540) % 360) - 180
  return (((from + delta * k) % 360) + 360) % 360
}

/** Great-circle distance in metres. */
export function distanceM(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLon = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Beyond this the car did not drive between pings (late buffered fix, first fix), so jump instead of gliding. */
export const GLIDE_MAX_M = 1500

/** Today's trail: the route in time order, plus the live fix if it is newer than the route's last point. */
export function trailCoordinates(route: Position[], latest: Position | null): LngLat[] {
  const sorted = [...route].sort((a, b) => a.fixTime - b.fixTime)
  const coords = sorted.map((p): LngLat => [p.lon, p.lat])
  const last = sorted[sorted.length - 1]
  if (latest && (!last || latest.fixTime > last.fixTime)) coords.push([latest.lon, latest.lat])
  return coords
}

export function trailFeature(coords: LngLat[]): FeatureCollection<LineString> {
  const features: Feature<LineString>[] =
    coords.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : []
  return { type: 'FeatureCollection', features }
}

export function siteFeatures(geofences: Geofence[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: geofences
      .filter((g) => g.kind === 'site')
      .map((g) => ({
        type: 'Feature' as const,
        properties: { name: g.name },
        geometry: { type: 'Polygon' as const, coordinates: [g.polygon] },
      })),
  }
}
