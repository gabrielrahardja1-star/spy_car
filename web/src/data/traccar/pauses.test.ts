import { describe, expect, it } from 'vitest'
import { config } from '../../config'
import type { Geofence, Position } from '../types'
import { derivePauses, totalPauseMs } from './pauses'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 8, 0, 0)
const fix = (min: number, speedKmh: number, lon = 119.4, lat = -5.1): Position => ({
  carId: 'c',
  fixTime: T0 + min * MIN,
  lat,
  lon,
  speedKmh,
  course: 0,
  motion: speedKmh > 3,
})
/** One fix per minute with the given speeds, starting at minute 0. */
const run = (speeds: number[]) => speeds.map((s, i) => fix(i, s))

const args = (fixes: Position[], end: number) => ({ carId: 'c', start: T0, end: T0 + end * MIN, fixes, geofences: [] as Geofence[], cfg: config })

describe('derivePauses', () => {
  it('finds a still run of at least 2 minutes and measures it to the next moving fix', () => {
    // minutes: 0-1 moving, 2-5 still (4 fixes), 6 moving
    const stops = derivePauses(args(run([40, 40, 0, 0, 0, 0, 40, 40]), 7))
    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({ carId: 'c', startTime: T0 + 2 * MIN, endTime: T0 + 6 * MIN, durationMs: 4 * MIN })
    expect(totalPauseMs(stops)).toBe(4 * MIN)
  })

  it('ignores a pause shorter than the minimum, but counts one exactly at it', () => {
    expect(derivePauses(args(run([40, 0, 40, 40]), 3))).toEqual([]) // 1 min
    expect(derivePauses(args(run([40, 0, 0, 40, 40]), 4))).toHaveLength(1) // 2 min
  })

  it('counts speed up to the moving threshold as standing still', () => {
    expect(derivePauses(args(run([40, 3, 2.5, 3, 40]), 4))).toHaveLength(1)
  })

  it('finds several pauses in order', () => {
    const stops = derivePauses(args(run([40, 0, 0, 0, 40, 40, 0, 0, 0, 40]), 9))
    expect(stops.map((s) => [s.startTime - T0, s.durationMs])).toEqual([
      [1 * MIN, 3 * MIN],
      [6 * MIN, 3 * MIN],
    ])
  })

  it('clips a trailing still run to the end of the trip and ignores fixes outside the trip', () => {
    const fixes = [fix(-5, 0), fix(-4, 0), ...run([40, 40, 0, 0, 0]), fix(20, 0)]
    const stops = derivePauses(args(fixes, 6))
    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({ startTime: T0 + 2 * MIN, endTime: T0 + 6 * MIN })
  })

  it('does not care about the order of the fixes', () => {
    const stops = derivePauses(args(run([40, 0, 0, 0, 40]).reverse(), 4))
    expect(stops).toHaveLength(1)
    expect(stops[0].durationMs).toBe(3 * MIN)
  })

  it('names the place of the pause and takes the fixes of the right car only', () => {
    const depot: Geofence = {
      id: 'g',
      name: 'Town depot',
      kind: 'place',
      polygon: [[119, -6], [120, -6], [120, -5], [119, -5], [119, -6]],
    }
    const other: Position = { ...fix(2, 0), carId: 'x' }
    const stops = derivePauses({ ...args(run([40, 0, 0, 0, 40]), 4), fixes: [...run([40, 0, 0, 0, 40]), other], geofences: [depot] })
    expect(stops).toHaveLength(1)
    expect(stops[0].place).toBe('Town depot')
  })

  it('returns nothing without fixes', () => {
    expect(derivePauses(args([], 10))).toEqual([])
  })
})
