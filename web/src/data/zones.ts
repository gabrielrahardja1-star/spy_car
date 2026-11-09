// Checkpoint passes and zone entries/exits, worked out from a truck's fixes (same for mock and Traccar data).
import { config } from '../config'
import { pointInRing } from './traccar/geo'
import type { Geofence, Position, ZoneEvent } from './types'

/** A second pass of the same checkpoint within this long is GPS wander at its edge, not a new pass. */
const REPASS_MS = 60_000

type LonLat = [number, number]

const cross = (o: LonLat, a: LonLat, b: LonLat) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

/** True when segment p-q crosses segment a-b. Lon/lat as a flat plane is fine at checkpoint scale. */
function segmentsCross(p: LonLat, q: LonLat, a: LonLat, b: LonLat): boolean {
  const d1 = cross(a, b, p)
  const d2 = cross(a, b, q)
  const d3 = cross(p, q, a)
  const d4 = cross(p, q, b)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

function crossesRing(p: LonLat, q: LonLat, ring: LonLat[]): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (segmentsCross(p, q, ring[j], ring[i])) return true
  return false
}

/**
 * Events along `fixes` (one car, ascending by fixTime), oldest first.
 * Checkpoints: one "pass" when the car is first seen inside, or when the line between two fixes crosses the checkpoint
 * without either fix landing in it (a small checkpoint between two fixes). Not across a signal gap: the path is unknown.
 * Other zones: "enter" and "exit" when consecutive fixes change sides. Being inside at the first fix is not an event.
 */
export function zoneEvents(fixes: Position[], geofences: Geofence[]): ZoneEvent[] {
  const out: ZoneEvent[] = []
  for (const g of geofences) {
    const event = (f: Position, time: number, kind: ZoneEvent['kind']): ZoneEvent => ({
      carId: f.carId,
      time,
      kind,
      geofenceId: g.id,
      name: g.name,
      zoneKind: g.kind,
    })
    let inside = false
    let lastPass = -Infinity
    fixes.forEach((f, i) => {
      const now = pointInRing(f.lon, f.lat, g.polygon)
      const prev = i > 0 ? fixes[i - 1] : null
      if (g.kind === 'checkpoint') {
        let at: number | null = null
        if (prev && now && !inside) at = f.fixTime
        else if (prev && !now && !inside && f.fixTime - prev.fixTime <= config.noSignalMs) {
          if (crossesRing([prev.lon, prev.lat], [f.lon, f.lat], g.polygon)) at = Math.round((prev.fixTime + f.fixTime) / 2)
        }
        if (at !== null && at - lastPass > REPASS_MS) out.push(event(f, at, 'pass'))
        if (at !== null || now) lastPass = Math.max(lastPass, at ?? f.fixTime)
      } else if (prev && now !== inside) {
        out.push(event(f, f.fixTime, now ? 'enter' : 'exit'))
      }
      inside = now
    })
  }
  return out.sort((a, b) => a.time - b.time)
}
