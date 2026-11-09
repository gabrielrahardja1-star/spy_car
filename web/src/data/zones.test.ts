import { describe, expect, it } from 'vitest'
import { zoneEvents } from './zones'
import type { Geofence, Position } from './types'

const MIN = 60_000
// A 0.001° square checkpoint (about 110 m) and a larger zone east of it, on a road running east along lat 0.
const square = (lon0: number, size: number): [number, number][] => [
  [lon0, -size / 2], [lon0 + size, -size / 2], [lon0 + size, size / 2], [lon0, size / 2], [lon0, -size / 2],
]
const CP: Geofence = { id: 'cp', name: 'CP1 Gate', kind: 'checkpoint', polygon: square(0.01, 0.001) }
const DUMP: Geofence = { id: 'd', name: 'Area 2', kind: 'site', polygon: square(0.02, 0.01) }
const fix = (min: number, lon: number, lat = 0): Position => ({ carId: 't', fixTime: min * MIN, lat, lon, speedKmh: 20, course: 90, motion: true })

describe('zoneEvents', () => {
  it('logs one pass when a fix lands in a checkpoint, then enter and exit for other zones', () => {
    const fixes = [fix(0, 0.005), fix(1, 0.0105), fix(2, 0.0108), fix(3, 0.015), fix(4, 0.025), fix(5, 0.026), fix(6, 0.035)]
    expect(zoneEvents(fixes, [CP, DUMP]).map((e) => [e.time / MIN, e.kind, e.name])).toEqual([
      [1, 'pass', 'CP1 Gate'],
      [4, 'enter', 'Area 2'],
      [6, 'exit', 'Area 2'],
    ])
  })

  it('finds a checkpoint crossed between two fixes, timed halfway', () => {
    const events = zoneEvents([fix(0, 0.009), fix(1, 0.012)], [CP])
    expect(events.map((e) => [e.time, e.kind])).toEqual([[30_000, 'pass']])
  })

  it('does not guess a pass across a signal gap', () => {
    expect(zoneEvents([fix(0, 0.009), fix(10, 0.012)], [CP])).toEqual([])
  })

  it('ignores GPS wander at the edge but counts a real second pass', () => {
    const wander = [fix(0, 0.009), fix(0.2, 0.0101), fix(0.4, 0.0099), fix(0.6, 0.0101), fix(0.8, 0.0099)]
    expect(zoneEvents(wander, [CP])).toHaveLength(1)
    const twice = [fix(0, 0.009), fix(1, 0.0105), fix(2, 0.013), fix(5, 0.0105), fix(6, 0.009)]
    expect(zoneEvents(twice, [CP]).map((e) => e.time / MIN)).toEqual([1, 5])
  })

  it('treats starting inside a zone as no event', () => {
    expect(zoneEvents([fix(0, 0.0105), fix(1, 0.0106)], [CP])).toEqual([])
    expect(zoneEvents([fix(0, 0.025), fix(1, 0.026)], [DUMP])).toEqual([])
  })
})
