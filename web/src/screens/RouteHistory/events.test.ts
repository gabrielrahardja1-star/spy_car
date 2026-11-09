import { describe, expect, it } from 'vitest'
import type { Geofence, Position, Trip } from '../../data/types'
import { eventsOf } from './events'

const MIN = 60_000
const ring = (lon0: number, size: number): [number, number][] => [
  [lon0, -size], [lon0 + size, -size], [lon0 + size, size], [lon0, size], [lon0, -size],
]
const FENCES: Geofence[] = [
  { id: 'p', name: 'Pit W', kind: 'place', polygon: ring(0, 0.004) },
  { id: 'cp', name: 'CP1 West gate', kind: 'checkpoint', polygon: ring(0.01, 0.0003) },
  { id: 'a', name: 'Area 2', kind: 'site', polygon: ring(0.02, 0.004) },
]
const fix = (min: number, lon: number): Position => ({ carId: 't', fixTime: min * MIN, lat: 0, lon, speedKmh: 18, course: 90, motion: true })
const TRIP: Trip = {
  id: 't-0', carId: 't', startTime: 0, endTime: 6 * MIN, startPlace: 'Pit W', endPlace: 'Area 2',
  distanceM: 2000, drivingMs: 6 * MIN, maxSpeedKmh: 20, stops: [],
}

describe('eventsOf', () => {
  it('adds checkpoint passes from the route between the start and end rows, without repeating them', () => {
    const route = [fix(0, 0.002), fix(1, 0.005), fix(2, 0.0101), fix(3, 0.015), fix(4, 0.021), fix(6, 0.022)]
    expect(eventsOf(TRIP, FENCES, route).map((e) => [e.time / MIN, e.kind, e.text])).toEqual([
      [0, 'move', 'Left Pit W'],
      [2, 'checkpoint', 'Passed CP1 West gate'],
      [6, 'end', 'Arrived at Area 2 zone'],
    ])
  })

  it('has only the trip rows without a route', () => {
    expect(eventsOf(TRIP, FENCES).map((e) => e.text)).toEqual(['Left Pit W', 'Arrived at Area 2 zone'])
  })
})
