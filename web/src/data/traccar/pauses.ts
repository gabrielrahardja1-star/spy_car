// Pauses inside a trip, worked out from its route. Traccar itself only reports parking of 5 min or more (which ends
// a trip), so a 3 minute fuel stop mid-drive is not in any report. Pure.
import { config, type Config } from '../../config'
import { sortPositions } from '../derive'
import type { Geofence, Position, Stop } from '../types'
import { geofenceNameAt } from './geo'

/**
 * Runs of consecutive fixes at (about) zero speed that last at least cfg.minPauseMs, inside [start, end].
 * A run lasts from its first still fix to the next fix after it (the first moving one), or to `end` if the trip
 * stops while still. Fixes may be unsorted or outside the trip; they are sorted and clipped here.
 * "Still" is the app's own rule: speed at or below cfg.movingKmh (Traccar's `motion` flag is too twitchy at standstill).
 */
export function derivePauses(args: {
  carId: string
  start: number
  end: number
  fixes: Position[]
  geofences: Geofence[]
  cfg?: Config
}): Stop[] {
  const { carId, start, end, geofences } = args
  const cfg = args.cfg ?? config
  const fixes = sortPositions(args.fixes.filter((p) => p.carId === carId && p.fixTime >= start && p.fixTime <= end))
  const stops: Stop[] = []
  let i = 0
  while (i < fixes.length) {
    if (fixes[i].speedKmh > cfg.movingKmh) {
      i++
      continue
    }
    let j = i
    while (j + 1 < fixes.length && fixes[j + 1].speedKmh <= cfg.movingKmh) j++
    const from = fixes[i].fixTime
    const to = j + 1 < fixes.length ? fixes[j + 1].fixTime : end
    if (to - from >= cfg.minPauseMs) {
      const at = fixes[i]
      stops.push({
        carId,
        startTime: from,
        endTime: to,
        durationMs: to - from,
        lat: at.lat,
        lon: at.lon,
        place: geofenceNameAt(at.lat, at.lon, geofences),
      })
    }
    i = j + 1
  }
  return stops
}

export function totalPauseMs(stops: Stop[]): number {
  return stops.reduce((sum, s) => sum + s.durationMs, 0)
}
