// Mine-site geofences around "Area 2" (South Kalimantan). The dump is the site zone; each pit's loading area is a place.
// Centres are the ends of the real haul roads in ./haulRoads; outlines are made up.
import type { Geofence } from '../types'
import { PIT_N_ROAD, PIT_S_ROAD, PIT_W_ROAD } from './haulRoads'
import { pointInRing } from './util'

export interface PlaceDef {
  id: string
  name: string
  kind: 'site' | 'place' | 'checkpoint'
  /** [lat, lon] */
  centre: [number, number]
  /** Outline as metre offsets [east, north] from the centre. */
  outline: [number, number][]
}

export const SITE: PlaceDef = {
  id: 'g-area2',
  name: 'Area 2',
  kind: 'site',
  centre: PIT_W_ROAD[PIT_W_ROAD.length - 1],
  outline: [[-190, -65], [-110, -190], [115, -175], [215, -30], [160, 165], [-85, 195], [-200, 80]],
}

export interface PitDef extends PlaceDef {
  /** Haul road from this pit's loading point to Area 2, [lat, lon]. */
  road: [number, number][]
}

const PIT_OUTLINE: [number, number][] = [[-200, -120], [-60, -210], [150, -170], [210, 20], [110, 190], [-120, 180], [-210, 50]]
const pit = (id: string, name: string, road: [number, number][]): PitDef => ({ id, name, kind: 'place', centre: road[0], outline: PIT_OUTLINE, road })

export const PIT_W = pit('g-pit-w', 'Pit W', PIT_W_ROAD)
export const PIT_N = pit('g-pit-n', 'Pit N', PIT_N_ROAD)
export const PIT_S = pit('g-pit-s', 'Pit S', PIT_S_ROAD)
export const PITS: PitDef[] = [PIT_W, PIT_N, PIT_S]

export const PLACES: PlaceDef[] = [SITE, ...PITS]

/** A 30 m circle as metre offsets. */
const CHECKPOINT_OUTLINE: [number, number][] = Array.from({ length: 16 }, (_, i): [number, number] => [
  Math.round(30 * Math.sin((i * Math.PI) / 8)),
  Math.round(30 * Math.cos((i * Math.PI) / 8)),
])
const checkpoint = (id: string, name: string, centre: [number, number]): PlaceDef => ({ id, name, kind: 'checkpoint', centre, outline: CHECKPOINT_OUTLINE })

/** Example checkpoints on the haul roads, until the real ones are known. Not places: trips never start or end "at" one. */
export const CHECKPOINTS: PlaceDef[] = [
  checkpoint('g-cp1', 'CP1 West gate', [-3.172592, 115.279189]), // Pit W and Pit N trucks, just outside Area 2
  checkpoint('g-cp2', 'CP2 South gate', [-3.174385, 115.281022]), // Pit S trucks, just outside Area 2
  checkpoint('g-cp3', 'CP3 Pit W ramp', [-3.170372, 115.271208]),
  checkpoint('g-cp4', 'CP4 South haul road', [-3.196313, 115.278824]),
]

function toPolygon(p: PlaceDef): [number, number][] {
  const [lat0, lon0] = p.centre
  const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ring = p.outline.map(([e, n]): [number, number] => [lon0 + e / mPerLon, lat0 + n / 110574])
  ring.push([ring[0][0], ring[0][1]])
  return ring
}

export function buildGeofences(): Geofence[] {
  return [...PLACES, ...CHECKPOINTS].map((p) => ({ id: p.id, name: p.name, kind: p.kind, polygon: toPolygon(p) }))
}

const polygons = PLACES.map((p) => ({ name: p.name, ring: toPolygon(p) }))

/** Name of the geofence containing the point, or null. */
export function placeAt(lat: number, lon: number): string | null {
  for (const g of polygons) if (pointInRing(lat, lon, g.ring)) return g.name
  return null
}
