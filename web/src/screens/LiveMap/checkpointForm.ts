// The add/edit checkpoint form: what has been typed, and the circle it describes.
import { parseCoordinates } from '../../data/coords'
import type { Circle } from '../../data/types'

export const DEFAULT_RADIUS_M = 30
export const MIN_RADIUS_M = 5
export const MAX_RADIUS_M = 500

/** The checkpoint being added (no id) or edited, as typed so far. */
export interface CheckpointForm {
  id?: string
  name: string
  location: string
  radius: string
}

export const newForm = (): CheckpointForm => ({ name: '', location: '', radius: String(DEFAULT_RADIUS_M) })

/** The circle the form describes, or null while the location or radius is not usable yet. */
export function formCircle(form: CheckpointForm): Circle | null {
  const point = parseCoordinates(form.location)
  const radiusM = Number(form.radius)
  if (!point || !Number.isFinite(radiusM) || radiusM < MIN_RADIUS_M || radiusM > MAX_RADIUS_M) return null
  return { ...point, radiusM }
}

export function problemOf(form: CheckpointForm): string | null {
  if (form.name.trim() === '') return 'Give the checkpoint a name.'
  if (!parseCoordinates(form.location)) return `Tap the map, or paste the location like 3°10'21.04"S 115°16'54.51"E.`
  const r = Number(form.radius)
  if (!Number.isFinite(r) || r < MIN_RADIUS_M || r > MAX_RADIUS_M) return `Size must be ${MIN_RADIUS_M} to ${MAX_RADIUS_M} m.`
  return null
}
