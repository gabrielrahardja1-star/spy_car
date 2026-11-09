// The add/edit location form: what has been typed, and the circle it describes.
import { parseCoordinates } from '../../data/coords'
import type { Circle, Geofence } from '../../data/types'

export type LocationKind = Geofence['kind']

/** How each kind of location is named on screen, explained, and sized by default. */
export const KINDS: Record<LocationKind, { label: string; hint: string; radiusM: number }> = {
  place: { label: 'Start point', hint: 'Where trucks load. Trips are named from it, as in "Klinik → Area 2".', radiusM: 50 },
  site: { label: 'End point (dump)', hint: 'Where trucks tip. Drawn as the orange zone; trips arrive "at Area 2 zone".', radiusM: 150 },
  checkpoint: { label: 'Checkpoint', hint: 'A gate or junction on the way. Every truck that passes is logged.', radiusM: 30 },
}
export const KIND_ORDER: LocationKind[] = ['place', 'site', 'checkpoint']

export const MIN_RADIUS_M = 5
export const MAX_RADIUS_M = 500

/** The location being added (no id) or edited, as typed so far. */
export interface LocationForm {
  id?: string
  name: string
  kind: LocationKind
  location: string
  radius: string
  /** True once the size was typed, so changing the type no longer resets it to that type's default. */
  radiusTouched: boolean
}

export const newForm = (kind: LocationKind = 'place'): LocationForm => ({
  name: '',
  kind,
  location: '',
  radius: String(KINDS[kind].radiusM),
  radiusTouched: false,
})

/** The circle the form describes, or null while the location or radius is not usable yet. */
export function formCircle(form: LocationForm): Circle | null {
  const point = parseCoordinates(form.location)
  const radiusM = Number(form.radius)
  if (!point || !Number.isFinite(radiusM) || radiusM < MIN_RADIUS_M || radiusM > MAX_RADIUS_M) return null
  return { ...point, radiusM }
}

export function problemOf(form: LocationForm): string | null {
  if (form.name.trim() === '') return 'Give the location a name.'
  if (!parseCoordinates(form.location)) return `Tap the map, or paste the location like 3°10'21.04"S 115°16'54.51"E.`
  const r = Number(form.radius)
  if (!Number.isFinite(r) || r < MIN_RADIUS_M || r > MAX_RADIUS_M) return `Size must be ${MIN_RADIUS_M} to ${MAX_RADIUS_M} m.`
  return null
}

/** Other locations whose circles overlap this one: a truck inside both would be "at" either, so trips read wrong. */
export function overlapsWith(circle: Circle, id: string | undefined, others: Geofence[]): string[] {
  return others
    .filter((g) => g.id !== id && g.circle)
    .filter((g) => {
      const c = g.circle!
      const dy = (c.lat - circle.lat) * 110574
      const dx = (c.lon - circle.lon) * 111320 * Math.cos((circle.lat * Math.PI) / 180)
      return Math.hypot(dx, dy) < c.radiusM + circle.radiusM
    })
    .map((g) => g.name)
}
