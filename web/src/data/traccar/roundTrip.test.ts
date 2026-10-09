// Mock source -> Traccar-shaped JSON (the same code the local fake server uses) -> the Traccar data source.
// Whatever the screens could show from the mock must come out the same through the Traccar code path.
import { beforeAll, describe, expect, it } from 'vitest'
import { addDays, dayBounds } from '../format'
import { summarizeTrips } from '../derive'
import { createMockDataSource } from '../mock'
import type { DataSource } from '../source'
import type { Car, Trip } from '../types'
import { FIXED_NOW } from '../../test/render'
import { createFakeBackend } from './fake/backend'
import { createFakeFetch, createFakeRouter, DEMO_EMAIL, DEMO_PASSWORD } from './fake/router'
import { createTraccarAuth } from './auth'
import { createTraccarDataSource } from './dataSource'

const now = () => FIXED_NOW

async function connect(options: { minParkingMs?: number; omitOpenTrip?: boolean } = {}) {
  const mock = createMockDataSource({ now })
  const backend = await createFakeBackend(mock, { now, ...options })
  const fetch = createFakeFetch(createFakeRouter(backend))
  expect(await createTraccarAuth({ baseUrl: '', fetch }).login(DEMO_EMAIL, DEMO_PASSWORD)).toEqual({ ok: true })
  const traccar = createTraccarDataSource({ baseUrl: '', fetch, now })
  return { mock, traccar, fetch }
}

const today = dayBounds(FIXED_NOW)
const weekFrom = addDays(today.start, -6)

/** Mock car id ("c1") for a Traccar car id ("1"): the fake numbers devices in the order of the mock's cars. */
function idMap(cars: Car[]): Map<string, string> {
  return new Map(cars.map((c, i) => [String(i + 1), c.id]))
}

const finished = (trips: Trip[]) => trips.filter((t) => t.endTime !== null)
const within = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1)

describe('round trip: mock -> Traccar JSON -> TraccarDataSource', () => {
  let mock: DataSource
  let traccar: DataSource
  let ids: Map<string, string>

  beforeAll(async () => {
    ;({ mock, traccar } = await connect())
    ids = idMap(await mock.getCars())
  })

  it('lists the same cars (device names on screen, driver label kept)', async () => {
    const [a, b] = await Promise.all([mock.getCars(), traccar.getCars()])
    expect(b.map((c) => [ids.get(c.id), c.name, c.driver])).toEqual(a.map((c) => [c.id, c.name, c.driver]))
  })

  it('returns the same geofences: shapes (latitude-first WKT swapped back), names and the site kind', async () => {
    const [a, b] = await Promise.all([mock.getGeofences(), traccar.getGeofences()])
    expect(b.map((g) => [g.name, g.kind])).toEqual(a.map((g) => [g.name, g.kind]))
    b.forEach((g, i) => expect(g.polygon).toEqual(a[i].polygon))
    expect(b.filter((g) => g.kind === 'site')).toHaveLength(1)
  })

  it('returns the same latest fixes', async () => {
    const [a, b] = await Promise.all([mock.getLatestPositions(), traccar.getLatestPositions()])
    expect(b).toHaveLength(a.length)
    for (const p of b) {
      const q = a.find((x) => x.carId === ids.get(p.carId))
      expect(q).toBeDefined()
      expect(p.fixTime).toBe(q?.fixTime)
      expect(p.lat).toBe(q?.lat)
      expect(p.motion).toBe(q?.motion)
      expect(p.speedKmh).toBeCloseTo(q?.speedKmh ?? 0, 6)
    }
  })

  it.each([
    ['today', today.start],
    ['7 days', weekFrom],
  ])('returns the same route for %s', async (_label, from) => {
    for (const [tId, mId] of ids) {
      const [a, b] = await Promise.all([mock.getRoute(mId, from, today.end), traccar.getRoute(tId, from, today.end)])
      expect(a.length).toBeGreaterThan(0)
      expect(b).toHaveLength(a.length)
      b.forEach((p, i) => {
        expect(p.fixTime).toBe(a[i].fixTime)
        expect(p.lat).toBe(a[i].lat)
        expect(p.lon).toBe(a[i].lon)
        expect(p.course).toBe(a[i].course)
        expect(p.speedKmh).toBeCloseTo(a[i].speedKmh, 6)
      })
    }
  })

  it('returns the same finished trips for today: times, places, distance within 1%, pauses', async () => {
    const a = finished(await mock.getTrips(null, today.start, today.end))
    const b = finished(await traccar.getTrips(null, today.start, today.end))
    expect(a.length).toBeGreaterThan(0)
    expect(b).toHaveLength(a.length)
    b.forEach((t, i) => {
      const m = a[i]
      expect(ids.get(t.carId)).toBe(m.carId)
      expect([t.startTime, t.endTime, t.startPlace, t.endPlace]).toEqual([m.startTime, m.endTime, m.startPlace, m.endPlace])
      expect(within(t.distanceM, m.distanceM, 0.01)).toBe(true)
      expect(t.stops.map((s) => s.startTime)).toEqual(m.stops.map((s) => s.startTime))
      t.stops.forEach((s, k) => expect(Math.abs(s.durationMs - m.stops[k].durationMs)).toBeLessThanOrEqual(30_000))
      expect(Math.abs(t.drivingMs - m.drivingMs)).toBeLessThanOrEqual(60_000)
      expect(t.stopsKnown).toBeUndefined()
    })
  })

  it('returns the same finished trips for 7 days; stops are marked unknown on the long range', async () => {
    const a = finished(await mock.getTrips(null, weekFrom, today.end))
    const b = finished(await traccar.getTrips(null, weekFrom, today.end))
    expect(a.length).toBeGreaterThan(3)
    expect(b).toHaveLength(a.length)
    b.forEach((t, i) => {
      const m = a[i]
      expect([ids.get(t.carId), t.startTime, t.endTime, t.startPlace, t.endPlace]).toEqual([m.carId, m.startTime, m.endTime, m.startPlace, m.endPlace])
      expect(within(t.distanceM, m.distanceM, 0.01)).toBe(true)
      expect(t.stopsKnown).toBe(false)
      expect(t.stops).toEqual([])
    })
  })

  it('shows the car that is driving as one in-progress trip, matching the mock', async () => {
    const [a, b] = await Promise.all([mock.getTrips(null, today.start, today.end), traccar.getTrips(null, today.start, today.end)])
    const open = a.filter((t) => t.endTime === null)
    const mine = b.filter((t) => t.endTime === null)
    expect(open).toHaveLength(1)
    expect(mine).toHaveLength(1)
    expect(ids.get(mine[0].carId)).toBe(open[0].carId)
    expect(mine[0].startTime).toBe(open[0].startTime)
    expect(mine[0].endPlace).toBeNull()
    expect(within(mine[0].distanceM, open[0].distanceM, 0.01)).toBe(true)
    expect(Math.abs(mine[0].drivingMs - open[0].drivingMs)).toBeLessThanOrEqual(60_000)
  })

  it('getSummary equals the totals of getTrips for the same range, and the mock summary', async () => {
    for (const [from, to] of [
      [today.start, today.end],
      [weekFrom, today.end],
    ]) {
      const [summary, trips, mockSummary] = await Promise.all([traccar.getSummary(from, to), traccar.getTrips(null, from, to), mock.getSummary(from, to)])
      for (const row of summary) {
        expect(row).toEqual(summarizeTrips(row.carId, trips))
        const m = mockSummary.find((x) => x.carId === ids.get(row.carId))
        expect(row.tripCount).toBe(m?.tripCount)
        expect(row.inProgressCount).toBe(m?.inProgressCount)
        expect(within(row.distanceM, m?.distanceM ?? 0, 0.01)).toBe(true)
      }
    }
  })

  it('getStops lists the in-trip pauses of the trips, newest first', async () => {
    const [stops, trips] = await Promise.all([traccar.getStops(null, today.start, today.end), traccar.getTrips(null, today.start, today.end)])
    expect(stops.map((s) => s.startTime)).toEqual(trips.flatMap((t) => t.stops).map((s) => s.startTime).sort((x, y) => y - x))
    expect(stops.length).toBeGreaterThan(0)
  })
})

describe('round trip with a Traccar that has not reported the unfinished trip yet', () => {
  it('builds the in-progress trip from the stops report and the route', async () => {
    const { mock, traccar } = await connect({ omitOpenTrip: true })
    const open = (await mock.getTrips(null, today.start, today.end)).filter((t) => t.endTime === null)
    const mine = (await traccar.getTrips(null, today.start, today.end)).filter((t) => t.endTime === null)
    expect(mine).toHaveLength(1)
    expect(Math.abs(mine[0].startTime - open[0].startTime)).toBeLessThanOrEqual(10_000)
    expect(within(mine[0].distanceM, open[0].distanceM, 0.02)).toBe(true)
    expect(mine[0].startPlace).toBe(open[0].startPlace)
  })
})

describe('round trip with real Traccar parking rules (a stop of 5 min or more ends the trip)', () => {
  it('splits trips at long stops but keeps the totals', async () => {
    const { mock, traccar } = await connect({ minParkingMs: 5 * 60_000 })
    const a = finished(await mock.getTrips(null, today.start, today.end))
    const b = finished(await traccar.getTrips(null, today.start, today.end))
    const longStops = a.flatMap((t) => t.stops).filter((s) => s.durationMs >= 5 * 60_000).length
    expect(longStops).toBeGreaterThan(0)
    expect(b).toHaveLength(a.length + longStops)
    const sum = (list: Trip[], key: 'distanceM' | 'drivingMs') => list.reduce((s, t) => s + t[key], 0)
    expect(within(sum(b, 'distanceM'), sum(a, 'distanceM'), 0.01)).toBe(true)
    // Pauses under 5 min are still found inside the pieces, so driving time stays close to the mock's.
    expect(Math.abs(sum(b, 'drivingMs') - sum(a, 'drivingMs'))).toBeLessThanOrEqual(2 * 60_000 * a.length)
  })
})
