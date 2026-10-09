// Invented geofences. Coordinates are made up; no real place names.
import type { Geofence } from '../types'
import { pointInRing } from './util'

export interface PlaceDef {
  id: string
  name: string
  kind: 'site' | 'place'
  /** [lat, lon] */
  centre: [number, number]
  /** Outline as metre offsets [east, north] from the centre. */
  outline: [number, number][]
}

export const SITE: PlaceDef = {
  id: 'g-site',
  name: 'Site',
  kind: 'site',
  centre: [-5.14, 119.41],
  outline: [[-520, -150], [-300, -380], [260, -340], [560, -60], [380, 330], [-260, 360], [-560, 120]],
}

export const DEPOT: PlaceDef = {
  id: 'g-depot',
  name: 'Town depot',
  kind: 'place',
  centre: [-5.4, 119.3],
  outline: [[-230, -170], [210, -190], [250, 80], [60, 200], [-240, 150]],
}

export const SUPPLIER: PlaceDef = {
  id: 'g-supplier',
  name: 'Supplier yard',
  kind: 'place',
  centre: [-4.96, 119.6],
  outline: [[-300, -220], [280, -240], [320, 160], [-20, 260], [-310, 180]],
}

export const PLACES: PlaceDef[] = [SITE, DEPOT, SUPPLIER]

/** An invented stop-off (fuel, shop, gate) a few km from a place. Not a geofence, so trips to it end in "Unknown place". */
export interface Waypoint {
  id: string
  /** [lat, lon] */
  centre: [number, number]
  near: PlaceDef
}

function offsetFrom(p: PlaceDef, eastM: number, northM: number): [number, number] {
  const [lat0, lon0] = p.centre
  return [lat0 + northM / 110574, lon0 + eastM / (111320 * Math.cos((lat0 * Math.PI) / 180))]
}

/** Short local hops in the history. Every one is well outside every geofence outline. */
export const WAYPOINTS: Waypoint[] = [
  { id: 'wp-depot-fuel', near: DEPOT, centre: offsetFrom(DEPOT, 2400, 3100) },
  { id: 'wp-depot-hardware', near: DEPOT, centre: offsetFrom(DEPOT, -5200, 6800) },
  { id: 'wp-site-gate', near: SITE, centre: offsetFrom(SITE, 4100, -5200) },
  { id: 'wp-site-junction', near: SITE, centre: offsetFrom(SITE, -1900, 2300) },
  { id: 'wp-supplier-fuel', near: SUPPLIER, centre: offsetFrom(SUPPLIER, -3600, -4400) },
]

function toPolygon(p: PlaceDef): [number, number][] {
  const [lat0, lon0] = p.centre
  const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ring = p.outline.map(([e, n]): [number, number] => [lon0 + e / mPerLon, lat0 + n / 110574])
  ring.push([ring[0][0], ring[0][1]])
  return ring
}

export function buildGeofences(): Geofence[] {
  return PLACES.map((p) => ({ id: p.id, name: p.name, kind: p.kind, polygon: toPolygon(p) }))
}

const polygons = PLACES.map((p) => ({ name: p.name, ring: toPolygon(p) }))

/** Name of the geofence containing the point, or null. */
export function placeAt(lat: number, lon: number): string | null {
  for (const g of polygons) if (pointInRing(lat, lon, g.ring)) return g.name
  return null
}
