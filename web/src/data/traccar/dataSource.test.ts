import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSocket } from '../../test/fakeSocket'
import { summarizeTrips } from '../derive'
import type { Position } from '../types'
import type { TraccarPosition } from './api'
import { createTraccarDataSource } from './dataSource'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = Date.UTC(2026, 9, 8, 6, 18) // 14:18 local
const DAY_START = Date.UTC(2026, 9, 7, 16) // 2026-10-08 00:00 in Asia/Makassar
const iso = (t: number) => new Date(t).toISOString()

const SITE_WKT = 'POLYGON ((-5.2 119.3, -5.2 119.5, -5.0 119.5, -5.0 119.3))'

/** Scripted Traccar: path -> handler. Records every request. */
function scripted(handlers: Record<string, (q: URLSearchParams) => unknown>) {
  const calls: { path: string; query: URLSearchParams }[] = []
  let inFlight = 0
  let maxInFlight = 0
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://x')
    calls.push({ path: url.pathname, query: url.searchParams })
    const handler = handlers[url.pathname]
    if (!handler) return new Response(null, { status: 404 })
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 1))
    inFlight--
    const body = handler(url.searchParams)
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { fetch, calls, maxInFlight: () => maxInFlight, count: (path: string) => calls.filter((c) => c.path === path).length }
}

const device = (id: number, name: string, extra: object = {}) => ({ id, name, status: 'online', ...extra })
const pos = (deviceId: number, t: number, over: Partial<TraccarPosition> & { lat?: number; lon?: number } = {}): TraccarPosition => ({
  deviceId,
  fixTime: iso(t),
  latitude: over.lat ?? -5.1,
  longitude: over.lon ?? 119.4,
  speed: 0,
  course: 0,
  ...over,
})
const tripRow = (deviceId: number, startMin: number, endMin: number, over: object = {}) => ({
  deviceId,
  startTime: iso(NOW + startMin * MIN),
  endTime: iso(NOW + endMin * MIN),
  distance: 10_000,
  maxSpeed: 20,
  startLat: -5.1,
  startLon: 119.4,
  endLat: -6,
  endLon: 120,
  ...over,
})

const baseHandlers = {
  '/api/devices': () => [device(1, 'Car 01', { attributes: { driver: 'D1' } }), device(2, 'Car 02'), device(9, 'Spare', { disabled: true })],
  '/api/geofences': () => [{ id: 1, name: 'site', area: SITE_WKT }, { id: 2, name: 'Broken', area: 'POLYGON ((x))' }],
}

function make(handlers: Record<string, (q: URLSearchParams) => unknown>, over: Parameters<typeof createTraccarDataSource>[0] = {}) {
  const s = scripted({ ...baseHandlers, ...handlers })
  const source = createTraccarDataSource({ baseUrl: '', fetch: s.fetch, now: () => NOW, WebSocketImpl: FakeSocket, ...over })
  return { source, ...s }
}

beforeEach(() => {
  FakeSocket.all = []
})

describe('cars and geofences', () => {
  it('lists enabled devices as cars; the driver label is optional', async () => {
    const { source } = make({})
    expect(await source.getCars()).toEqual([
      { id: '1', name: 'Car 01', driver: 'D1' },
      { id: '2', name: 'Car 02', driver: '' },
    ])
  })

  it('reads geofences, marks the site by name and skips unusable shapes', async () => {
    const { source } = make({})
    const g = await source.getGeofences()
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ name: 'site', kind: 'site' })
  })

  it('asks the server once for several quick calls', async () => {
    const { source, count } = make({})
    await Promise.all([source.getCars(), source.getCars(), source.getGeofences(), source.getGeofences()])
    expect(count('/api/devices')).toBe(1)
    expect(count('/api/geofences')).toBe(1)
  })
})

describe('positions', () => {
  it('converts the latest positions: knots to km/h, ISO to ms, device id to car id; unknown devices dropped', async () => {
    const { source } = make({
      '/api/positions': () => [pos(1, NOW - 4000, { speed: 10, course: 45, attributes: { motion: true } }), pos(2, NOW - MIN), pos(77, NOW)],
    })
    const latest = await source.getLatestPositions()
    expect(latest.map((p) => p.carId).sort()).toEqual(['1', '2'])
    const p1 = latest.find((p) => p.carId === '1') as Position
    expect(p1.fixTime).toBe(NOW - 4000)
    expect(p1.speedKmh).toBeCloseTo(18.52, 6)
    expect(p1.course).toBe(45)
    expect(p1.motion).toBe(true)
  })

  it('getRoute asks for the car and range, sorts out-of-order fixes, drops duplicates and fixes outside [from, to)', async () => {
    const from = NOW - HOUR
    const to = NOW
    const { source, calls } = make({
      '/api/reports/route': () => [
        pos(1, from + 3 * MIN),
        pos(1, from + MIN), // late, out of order
        pos(1, from + 3 * MIN), // duplicate
        pos(1, from), // at from: kept
        pos(1, to), // at to: excluded
        pos(1, to + MIN), // beyond
        pos(1, from - MIN), // before
        pos(2, from + 2 * MIN), // another car
      ],
    })
    const route = await source.getRoute('1', from, to)
    expect(route.map((p) => p.fixTime)).toEqual([from, from + MIN, from + 3 * MIN])
    const q = calls.find((c) => c.path === '/api/reports/route')?.query
    expect(q?.getAll('deviceId')).toEqual(['1'])
    expect(q?.get('from')).toBe(iso(from).replace('.000Z', 'Z'))
    expect(q?.get('to')).toBe(iso(to).replace('.000Z', 'Z'))
  })
})

describe('trips', () => {
  const handlers = (extra: Record<string, (q: URLSearchParams) => unknown> = {}) => ({
    '/api/positions': () => [pos(1, NOW - 30 * MIN), pos(2, NOW - 30 * MIN)], // both parked
    '/api/reports/trips': () => [
      tripRow(1, -300, -240, { startLat: -5.1, startLon: 119.4, startAddress: 'Main St' }),
      tripRow(2, -200, -150),
      tripRow(1, -2000, -1990), // ended long before the range
    ],
    '/api/reports/route': () => [],
    ...extra,
  })

  it('maps Traccar trips: asks for all cars with a padded start, keeps only those overlapping the range', async () => {
    const from = NOW - 6 * HOUR
    const { source, calls } = make(handlers())
    const trips = await source.getTrips(null, from, NOW)
    const q = calls.find((c) => c.path === '/api/reports/trips')?.query
    expect(q?.getAll('deviceId')).toEqual(['1', '2'])
    expect(q?.get('from')).toBe(iso(from - 6 * HOUR).replace('.000Z', 'Z'))
    expect(trips.map((t) => t.carId)).toEqual(['2', '1']) // newest first
    expect(trips[1]).toMatchObject({ startPlace: 'site', endPlace: null, startAddress: 'Main St', distanceM: 10_000 })
  })

  it('a single car is asked for on its own', async () => {
    const { source, calls } = make(handlers())
    const trips = await source.getTrips('2', NOW - 6 * HOUR, NOW)
    expect(calls.find((c) => c.path === '/api/reports/trips')?.query.getAll('deviceId')).toEqual(['2'])
    expect(trips.every((t) => t.carId === '2')).toBe(true)
  })

  it('derives in-trip pauses from each trip route, at most 4 routes at a time, and caches them', async () => {
    const list = Array.from({ length: 8 }, (_, i) => tripRow(1, -400 + i * 40, -380 + i * 40))
    const route = (q: URLSearchParams) => {
      const start = Date.parse(q.get('from') as string)
      // 3 min of standing still in the middle of a 20 min trip
      return [0, 5, 6, 7, 8, 9, 20].map((m) => pos(1, start + m * MIN, { speed: m >= 6 && m <= 8 ? 0 : 20, attributes: { motion: m < 6 || m > 8 } }))
    }
    const { source, count, maxInFlight } = make(handlers({ '/api/reports/trips': () => list, '/api/reports/route': route }))
    const first = await source.getTrips('1', NOW - 8 * HOUR, NOW)
    expect(first).toHaveLength(8)
    for (const t of first) {
      expect(t.stops).toHaveLength(1)
      expect(t.stops[0].durationMs).toBe(3 * MIN) // fix at minute 6 to the next fix (minute 9)
      expect(t.drivingMs).toBe(17 * MIN)
      expect(t.stopsKnown).toBeUndefined()
    }
    expect(count('/api/reports/route')).toBe(8)
    expect(maxInFlight()).toBeLessThanOrEqual(4)
    await source.getTrips('1', NOW - 8 * HOUR, NOW)
    expect(count('/api/reports/route')).toBe(8) // finished trips are cached
  })

  it('on a range over 2 days it does not fetch routes and marks stops unknown', async () => {
    const { source, count } = make(handlers())
    const trips = await source.getTrips(null, NOW - 7 * 24 * HOUR, NOW)
    expect(trips.length).toBeGreaterThan(0)
    expect(count('/api/reports/route')).toBe(0)
    for (const t of trips) {
      expect(t.stopsKnown).toBe(false)
      expect(t.stops).toEqual([])
      expect(t.drivingMs).toBe(Date.parse(iso(t.endTime as number)) - t.startTime)
    }
  })

  it('does not ask for routes of finished trips when a range ends in the past', async () => {
    const { source, count } = make(handlers())
    await source.getTrips(null, DAY_START - 24 * HOUR, DAY_START)
    expect(count('/api/reports/stops')).toBe(0)
  })
})

describe('the trip in progress', () => {
  /** Car 1 parked until minute -20, then driving east, last fix 1 min ago. */
  const drivingRoute = (q: URLSearchParams): TraccarPosition[] => {
    const from = Date.parse(q.get('from') as string)
    const out: TraccarPosition[] = []
    for (let m = -60; m <= -1; m++) {
      const t = NOW + m * MIN
      if (t < from) continue
      const moving = m >= -20
      out.push(pos(1, t, { lon: 119.4 + (moving ? (m + 20) * 0.001 : 0), speed: moving ? 20 : 0, attributes: { motion: moving } }))
    }
    return out
  }
  const handlers = (open: boolean) => ({
    '/api/positions': () => [pos(1, NOW - MIN, { lon: 119.419, speed: 20, attributes: { motion: true } }), pos(2, NOW - 3 * HOUR)],
    '/api/reports/trips': () => (open ? [tripRow(1, -20, -1, { startLat: -5.1, startLon: 119.4 })] : []),
    '/api/reports/stops': () => [{ deviceId: 1, startTime: iso(NOW - 5 * HOUR), endTime: iso(NOW - 20 * MIN) }],
    '/api/reports/route': drivingRoute,
  })

  it('builds it from the stops report and the route when Traccar has not reported the trip yet', async () => {
    const { source } = make(handlers(false))
    const trips = await source.getTrips('1', DAY_START, DAY_START + 24 * HOUR)
    expect(trips).toHaveLength(1)
    expect(trips[0]).toMatchObject({ carId: '1', startTime: NOW - 20 * MIN, endTime: null, endPlace: null, startPlace: 'site' })
    expect(trips[0].distanceM).toBeGreaterThan(1500)
    expect(trips[0].drivingMs).toBe(19 * MIN)
  })

  it('replaces the unfinished trip Traccar reports at the latest fix, so the car has one trip, not two', async () => {
    const { source } = make(handlers(true))
    const trips = await source.getTrips('1', DAY_START, DAY_START + 24 * HOUR)
    expect(trips).toHaveLength(1)
    expect(trips[0].endTime).toBeNull()
    expect(trips[0].startTime).toBe(NOW - 20 * MIN)
  })

  it('gives no in-progress trip for a parked car, or for a range that ended in the past', async () => {
    const parked = make({ ...handlers(false), '/api/positions': () => [pos(1, NOW - MIN, { speed: 0 })] })
    expect(await parked.source.getTrips('1', DAY_START, DAY_START + 24 * HOUR)).toEqual([])
    const past = make(handlers(false))
    expect(await past.source.getTrips('1', DAY_START - 24 * HOUR, DAY_START)).toEqual([])
  })

  it('getSummary equals the totals of getTrips, in-progress trip included', async () => {
    const { source } = make({
      ...handlers(false),
      '/api/reports/trips': () => [tripRow(2, -600, -500, { distance: 5000 })],
    })
    const [summary, trips] = await Promise.all([
      source.getSummary(DAY_START, DAY_START + 24 * HOUR),
      source.getTrips(null, DAY_START, DAY_START + 24 * HOUR),
    ])
    expect(summary).toEqual([summarizeTrips('1', trips), summarizeTrips('2', trips)])
    expect(summary[0]).toMatchObject({ tripCount: 1, inProgressCount: 1 })
    expect(summary[1]).toMatchObject({ tripCount: 1, distanceM: 5000, inProgressCount: 0 })
  })

  it('getStops returns the pauses inside the trips', async () => {
    const { source } = make({
      ...handlers(false),
      '/api/reports/trips': () => [tripRow(2, -300, -280)],
      '/api/reports/route': (q) => {
        const start = Date.parse(q.get('from') as string)
        return [0, 5, 6, 10, 20].map((m) => pos(2, start + m * MIN, { speed: m === 6 ? 0 : 20, attributes: { motion: m !== 6 } }))
      },
    })
    const stops = await source.getStops('2', DAY_START, DAY_START + 24 * HOUR)
    expect(stops).toHaveLength(1)
    expect(stops[0]).toMatchObject({ carId: '2', durationMs: 4 * MIN })
  })
})

describe('live', () => {
  it('opens /api/socket, converts positions, and reports every message, even an empty keep-alive', () => {
    const { source } = make({}, { baseUrl: 'https://t.example.com' })
    const onPositions = vi.fn()
    const onMessage = vi.fn()
    const stop = source.subscribe({ onPositions, onMessage })
    expect(FakeSocket.last().url).toBe('wss://t.example.com/api/socket')
    FakeSocket.last().open()

    FakeSocket.last().send({ positions: [pos(1, NOW, { speed: 10 }), pos(1, NOW - 5000)] })
    expect(onPositions).toHaveBeenCalledTimes(1)
    expect(onPositions.mock.calls[0][0].map((p: Position) => p.fixTime)).toEqual([NOW - 5000, NOW]) // sorted
    expect(onMessage).toHaveBeenCalledTimes(1)

    FakeSocket.last().send({})
    FakeSocket.last().send({ devices: [device(1, 'Car 01')], events: [{ type: 'deviceOnline' }] })
    expect(onPositions).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledTimes(3)

    stop()
    expect(FakeSocket.last().closed).toBe(true)
  })

  it('derives the socket URL from the page location when the server is on the same origin', () => {
    const { source } = make({})
    source.subscribe({ onPositions: () => {} })
    expect(FakeSocket.last().url).toBe(`${globalThis.location.protocol === 'https:' ? 'wss' : 'ws'}://${globalThis.location.host}/api/socket`)
  })

  it('shares one socket between subscribers and closes it with the last one', () => {
    const { source } = make({})
    const a = source.subscribe({ onPositions: () => {} })
    const b = source.subscribe({ onPositions: () => {} })
    expect(FakeSocket.all).toHaveLength(1)
    a()
    expect(FakeSocket.last().closed).toBe(false)
    b()
    expect(FakeSocket.last().closed).toBe(true)
  })

  it('reports the connection state, starting with the current one', () => {
    const { source } = make({})
    const seen: string[] = []
    const off = source.onConnectionChange?.((s) => seen.push(s))
    expect(seen).toEqual(['reconnecting'])
    source.subscribe({ onPositions: () => {} })
    FakeSocket.last().open()
    FakeSocket.last().drop()
    expect(seen).toEqual(['reconnecting', 'connected', 'reconnecting'])
    off?.()
    FakeSocket.last().open()
    expect(seen).toHaveLength(3)
  })
})

describe('signed-out sessions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onUnauthorized when any call is answered 401, and the call rejects', async () => {
    const onUnauthorized = vi.fn()
    const { source } = make({ '/api/positions': () => new Response(null, { status: 401 }) }, { onUnauthorized })
    await expect(source.getLatestPositions()).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalled()
  })

  it('does not treat a server error as signed out', async () => {
    const onUnauthorized = vi.fn()
    const { source } = make({ '/api/positions': () => new Response(null, { status: 500 }) }, { onUnauthorized })
    await expect(source.getLatestPositions()).rejects.toMatchObject({ status: 500 })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('treats a refused live connection with a dead session as signed out', async () => {
    const onUnauthorized = vi.fn()
    const { source } = make({ '/api/session': () => new Response(null, { status: 404 }) }, { onUnauthorized })
    source.subscribe({ onPositions: () => {} })
    FakeSocket.last().drop() // never opened
    await vi.waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1))
  })

  it('keeps retrying when the live connection fails but the session is fine', async () => {
    const onUnauthorized = vi.fn()
    const { source, count } = make({ '/api/session': () => ({ id: 1 }) }, { onUnauthorized })
    source.subscribe({ onPositions: () => {} })
    FakeSocket.last().drop()
    await vi.waitFor(() => expect(count('/api/session')).toBe(1))
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
