// The mine site around "Area 2" (South Kalimantan), from the site's own coordinates (Nov 2026): four start points where
// trucks load, and Area 2, the end point where they tip (the site zone). Every zone is a circle, the way the Manage tab
// makes them. One example checkpoint sits on the approach road all four routes share into Area 2.
import type { Geofence, LocationInput } from '../types'
import { circleToRing } from '../traccar/wkt'
import { CONVEYOR_ROAD, CWP_ROAD, KLINIK_ROAD, VENTILASI_ROAD } from './haulRoads'
import { pointInRing } from './util'

export interface Zone {
  id: string
  name: string
  kind: Geofence['kind']
  lat: number
  lon: number
  radiusM: number
}

/** A start point and the real road from it to Area 2 ([lat, lon], start first). */
export interface StartPoint extends Zone {
  road: [number, number][]
}

export const SITE: Zone = { id: 'g-area2', name: 'Area 2', kind: 'site', lat: -3.172511, lon: 115.281808, radiusM: 150 } // 3°10'21.04"S 115°16'54.51"E

/** Ventilasi and CWP are only 120 m apart, so start points stay small enough not to overlap. */
const START_RADIUS_M = 50
const start = (id: string, name: string, lat: number, lon: number, road: [number, number][]): StartPoint => ({
  id,
  name,
  kind: 'place',
  lat,
  lon,
  radiusM: START_RADIUS_M,
  road,
})

export const KLINIK = start('g-klinik', 'Klinik', -3.178875, 115.272158, KLINIK_ROAD) // 3°10'43.95"S 115°16'19.77"E
export const VENTILASI = start('g-ventilasi', 'Ventilasi', -3.177925, 115.273756, VENTILASI_ROAD) // 3°10'40.53"S 115°16'25.52"E
export const CWP = start('g-cwp', 'CWP', -3.176917, 115.273364, CWP_ROAD) // 3°10'36.90"S 115°16'24.11"E
export const CONVEYOR = start('g-conveyor', 'Belakang Conveyor', -3.176414, 115.275161, CONVEYOR_ROAD) // 3°10'35.09"S 115°16'30.58"E
export const STARTS: StartPoint[] = [KLINIK, VENTILASI, CWP, CONVEYOR]

export const PLACES: Zone[] = [SITE, ...STARTS]

/** Example checkpoint, until real ones are added in the Manage tab. Trips never start or end "at" a checkpoint. */
export const CHECKPOINTS: Zone[] = [
  { id: 'g-cp-gate', name: 'CP Area 2 gate', kind: 'checkpoint', lat: -3.172592, lon: 115.279189, radiusM: 30 },
]

function toGeofence(z: Zone): Geofence {
  return {
    id: z.id,
    name: z.name,
    kind: z.kind,
    polygon: circleToRing(z.lat, z.lon, z.radiusM),
    circle: { lat: z.lat, lon: z.lon, radiusM: z.radiusM },
  }
}

export function buildGeofences(): Geofence[] {
  return [...PLACES, ...CHECKPOINTS].map(toGeofence)
}

/** A location as a circular geofence, the way Traccar returns one drawn as a circle. */
export function locationGeofence(id: string, input: LocationInput): Geofence {
  return toGeofence({ id, name: input.name, kind: input.kind, lat: input.lat, lon: input.lon, radiusM: input.radiusM })
}

const polygons = PLACES.map((p) => ({ name: p.name, ring: circleToRing(p.lat, p.lon, p.radiusM) }))

/** Name of the geofence containing the point, or null. */
export function placeAt(lat: number, lon: number): string | null {
  for (const g of polygons) if (pointInRing(lat, lon, g.ring)) return g.name
  return null
}
