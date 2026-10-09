import { describe, expect, it } from 'vitest'
import { config } from '../../config'
import type { Geofence, Position, Trip } from '../types'
import { haversineM } from './geo'
import { buildInProgressTrip, drivingStart, findOpenTrip, PARKING_ENDS_TRIP_MS, withInProgress } from './inProgress'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 8, 6, 0)
const NOW = T0 + 60 * MIN
/** A car driving east, 0.001 degrees of longitude per minute while moving. */
function drive(spec: ('m' | 's')[], startMin = 0): Position[] {
  let lon = 119.4
  return spec.map((k, i) => {
    if (k === 'm') lon += 0.001
    return { carId: 'c', fixTime: T0 + (startMin + i) * MIN, lat: -5.1, lon, speedKmh: k === 'm' ? 40 : 0, course: 90, motion: k === 'm' }
  })
}
const rep = (k: 'm' | 's', n: number) => Array.from({ length: n }, () => k)
const site: Geofence = {
  id: 's',
  name: 'Site',
  kind: 'site',
  polygon: [[119.3, -5.2], [119.45, -5.2], [119.45, -5.0], [119.3, -5.0], [119.3, -5.2]],
}

const build = (route: Position[], over: Partial<Parameters<typeof buildInProgressTrip>[0]> = {}) =>
  buildInProgressTrip({
    carId: 'c',
    latest: route[route.length - 1] ?? null,
    route,
    openTripStart: null,
    geofences: [site],
    now: NOW,
    deriveStops: true,
    cfg: config,
    ...over,
  })

describe('drivingStart', () => {
  it('is the first moving fix after the last long parked run', () => {
    const fixes = drive([...rep('m', 3), ...rep('s', 8), ...rep('m', 5)])
    expect(drivingStart(fixes, config)).toBe(T0 + 11 * MIN)
  })

  it('does not break at a short pause (under the parking time that ends a trip)', () => {
    const fixes = drive([...rep('m', 3), ...rep('s', 3), ...rep('m', 5)])
    expect(drivingStart(fixes, config)).toBe(T0)
  })

  it('treats exactly the parking time as parked', () => {
    const fixes = drive([...rep('m', 2), ...rep('s', 5), ...rep('m', 2)])
    // still fixes at min 2..6, next moving fix at min 7: 5 min
    expect(7 * MIN - 2 * MIN).toBe(PARKING_ENDS_TRIP_MS)
    expect(drivingStart(fixes, config)).toBe(T0 + 7 * MIN)
  })

  it('starts at the first fix of the window when the car never stopped in it', () => {
    expect(drivingStart(drive(rep('m', 6)), config)).toBe(T0)
  })

  it('is null when nothing moves', () => {
    expect(drivingStart(drive(rep('s', 6)), config)).toBeNull()
  })
})

describe('buildInProgressTrip', () => {
  it('builds an open trip from the first moving fix after the last long stop', () => {
    const route = drive([...rep('s', 20), ...rep('m', 11)], 29) // last fix at minute 59, 1 min before NOW
    const trip = build(route)
    expect(trip).not.toBeNull()
    expect(trip).toMatchObject({
      id: `c-${T0 + 49 * MIN}`,
      carId: 'c',
      startTime: T0 + 49 * MIN,
      endTime: null,
      endPlace: null,
      stops: [],
    })
    expect(trip?.startPlace).toBe('Site')
    expect(trip?.drivingMs).toBe(10 * MIN)
    // distance = haversine along the route since the start
    const since = route.filter((p) => p.fixTime >= T0 + 49 * MIN)
    let expected = 0
    for (let i = 1; i < since.length; i++) expected += haversineM(since[i - 1].lat, since[i - 1].lon, since[i].lat, since[i].lon)
    expect(trip?.distanceM).toBe(Math.round(expected))
    expect(trip?.maxSpeedKmh).toBe(40)
  })

  it('takes Traccar\'s own start when it reported an unfinished trip', () => {
    const route = drive(rep('m', 20), 40)
    const trip = build(route, { openTripStart: T0 + 45 * MIN })
    expect(trip?.startTime).toBe(T0 + 45 * MIN)
    expect(trip?.drivingMs).toBe(14 * MIN) // last fix at minute 59
  })

  it('subtracts derived pauses from the driving time', () => {
    const route = drive([...rep('m', 5), ...rep('s', 3), ...rep('m', 5)], 47) // minutes 47..59
    const trip = build(route)
    expect(trip?.stops).toHaveLength(1)
    expect(trip?.stops[0].durationMs).toBe(3 * MIN)
    expect(trip?.drivingMs).toBe(12 * MIN - 3 * MIN)
  })

  it('marks stops as unknown (and keeps the whole duration) when asked not to derive them', () => {
    const route = drive([...rep('m', 5), ...rep('s', 3), ...rep('m', 5)], 47)
    const trip = build(route, { deriveStops: false })
    expect(trip?.stopsKnown).toBe(false)
    expect(trip?.stops).toEqual([])
    expect(trip?.drivingMs).toBe(12 * MIN)
  })

  it('is null when the car is parked, has no signal, or never reported', () => {
    expect(build(drive([...rep('m', 5), ...rep('s', 4)], 50))).toBeNull() // parked
    expect(build(drive(rep('m', 5), 30))).toBeNull() // last fix 25 min old
    expect(build([], { latest: null })).toBeNull()
  })

  it('works from the latest fix alone', () => {
    const only = drive(['m'], 59)
    const trip = build(only)
    expect(trip).toMatchObject({ startTime: T0 + 59 * MIN, distanceM: 0, drivingMs: 0, endTime: null })
  })
})

describe('findOpenTrip / withInProgress', () => {
  const trip = (id: string, startMin: number, endMin: number): Trip => ({
    id,
    carId: 'c',
    startTime: T0 + startMin * MIN,
    endTime: T0 + endMin * MIN,
    startPlace: null,
    endPlace: null,
    distanceM: 1000,
    drivingMs: (endMin - startMin) * MIN,
    maxSpeedKmh: 30,
    stops: [],
  })
  const latest = drive(['m'], 59)[0]

  it('treats the newest trip as Traccar\'s unfinished one when it ends at the latest fix', () => {
    const trips = [trip('a', 0, 20), trip('b', 40, 58)]
    expect(findOpenTrip(trips, latest)?.id).toBe('b')
    expect(findOpenTrip([trip('a', 0, 20)], latest)).toBeNull() // ended 39 min ago
    expect(findOpenTrip([], latest)).toBeNull()
    expect(findOpenTrip(trips, null)).toBeNull()
  })

  it('replaces the unfinished trip, or appends, newest first', () => {
    const a = trip('a', 0, 20)
    const b = trip('b', 40, 58)
    const live = { ...trip('c-live', 40, 59), endTime: null }
    expect(withInProgress([a, b], b, live).map((t) => t.id)).toEqual(['c-live', 'a'])
    expect(withInProgress([a], null, live).map((t) => t.id)).toEqual(['c-live', 'a'])
    expect(withInProgress([a, b], null, null)).toEqual([a, b])
  })
})
