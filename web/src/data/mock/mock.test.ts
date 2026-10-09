import { afterEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../config'
import type { Position, SignalGap, Trip } from '../types'
import { findSignalGaps } from '../derive'
import { addDays } from '../format'
import { createMockDataSource } from './index'
import { PLACES, WAYPOINTS, placeAt } from './places'
import { startFeed, BUFFER_RELEASE_MS } from './live'
import { haversineM, localDayStart, localWeekday, MINUTE, HOUR } from './util'

const DAY = 24 * HOUR
// 14:18 local on 8 Oct 2026 (UTC+8).
const NOW = Date.UTC(2026, 9, 8, 6, 18)
const TODAY = localDayStart(NOW, config.timezone)

function routeLength(route: Position[]): number {
  let sum = 0
  for (let i = 1; i < route.length; i++) sum += haversineM(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon)
  return sum
}

describe('mock data source', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists two cars and three geofences with closed rings', async () => {
    const ds = createMockDataSource({ now: () => NOW })
    expect((await ds.getCars()).map((c) => [c.id, c.name, c.driver])).toEqual([
      ['c1', 'Car 01', '[Driver name]'],
      ['c2', 'Car 02', '[Driver name]'],
    ])
    const fences = await ds.getGeofences()
    expect(fences.map((g) => [g.name, g.kind])).toEqual([
      ['Site', 'site'],
      ['Town depot', 'place'],
      ['Supplier yard', 'place'],
    ])
    for (const g of fences) expect(g.polygon[0]).toEqual(g.polygon[g.polygon.length - 1])
  })

  it('is deterministic for a fixed now', async () => {
    const a = createMockDataSource({ now: () => NOW })
    const b = createMockDataSource({ now: () => NOW })
    const from = TODAY - 30 * DAY
    expect(await a.getTrips(null, from, NOW + 1)).toEqual(await b.getTrips(null, from, NOW + 1))
    expect(await a.getRoute('c1', from, NOW + 1)).toEqual(await b.getRoute('c1', from, NOW + 1))
    expect(await a.getLatestPositions()).toEqual(await b.getLatestPositions())
  })

  it.each([
    ['today', TODAY],
    ['7 days', TODAY - 6 * DAY],
    ['30 days', TODAY - 29 * DAY],
  ])('summary equals the totals from getTrips (%s)', async (_label, from) => {
    const ds = createMockDataSource({ now: () => NOW })
    const to = NOW + 1
    const summary = await ds.getSummary(from, to)
    expect(summary.map((s) => s.carId)).toEqual(['c1', 'c2'])
    for (const row of summary) {
      const trips = await ds.getTrips(row.carId, from, to)
      expect(row.tripCount).toBe(trips.length)
      expect(row.distanceM).toBe(trips.reduce((s, t) => s + t.distanceM, 0))
      expect(row.drivingMs).toBe(trips.reduce((s, t) => s + t.drivingMs, 0))
      expect(row.stopCount).toBe(trips.reduce((s, t) => s + t.stops.length, 0))
      expect(row.inProgressCount).toBe(trips.filter((t) => t.endTime === null).length)
      expect(trips.length).toBeGreaterThan(0)
    }
  })

  it('returns routes sorted ascending and inside [from, to)', async () => {
    const ds = createMockDataSource({ now: () => NOW })
    const from = TODAY - 3 * DAY + 5 * HOUR
    const to = TODAY + 10 * HOUR
    for (const carId of ['c1', 'c2']) {
      const route = await ds.getRoute(carId, from, to)
      expect(route.length).toBeGreaterThan(50)
      route.forEach((p, i) => {
        expect(p.carId).toBe(carId)
        expect(p.fixTime).toBeGreaterThanOrEqual(from)
        expect(p.fixTime).toBeLessThan(to)
        expect(p.motion).toBe(p.speedKmh > config.movingKmh)
        if (i > 0) expect(p.fixTime).toBeGreaterThan(route[i - 1].fixTime)
      })
    }
  })

  it('has one in-progress trip for c1 and none for c2', async () => {
    const ds = createMockDataSource({ now: () => NOW })
    const all = await ds.getTrips(null, 0, NOW + 1)
    const open = all.filter((t) => t.endTime === null)
    expect(open).toHaveLength(1)
    expect(open[0].carId).toBe('c1')
    expect(open[0].startPlace).toBe('Town depot')
    expect(open[0].endPlace).toBeNull()
    expect(open[0].distanceM).toBeGreaterThan(0)
    expect(all.filter((t) => t.carId === 'c2' && t.endTime === null)).toHaveLength(0)
    // Newest first.
    all.forEach((t, i) => i > 0 && expect(t.startTime).toBeLessThanOrEqual(all[i - 1].startTime))
  })

  it("tells today's story", async () => {
    const ds = createMockDataSource({ now: () => NOW })
    const trips = await ds.getTrips(null, TODAY, NOW + 1)
    const c1 = trips.filter((t) => t.carId === 'c1')
    const c2 = trips.filter((t) => t.carId === 'c2')
    expect(c1).toHaveLength(2)
    expect(c2).toHaveLength(1)
    const morning = c1[1]
    expect(morning.startPlace).toBe('Site')
    expect(morning.endPlace).toBe('Town depot')
    expect(morning.distanceM / 1000).toBeGreaterThan(40)
    expect(morning.distanceM / 1000).toBeLessThan(42)
    expect(morning.drivingMs).toBe(72 * MINUTE)
    expect(morning.stops.map((s) => s.durationMs)).toEqual([3 * MINUTE, 8 * MINUTE])
    expect(c2[0].startPlace).toBe('Supplier yard')
    expect(c2[0].endPlace).toBe('Site')
    for (const t of trips) expect(t.startTime).toBeGreaterThanOrEqual(TODAY)
    const latest = await ds.getLatestPositions()
    const car1 = latest.find((p) => p.carId === 'c1')!
    expect(car1.motion).toBe(true)
    expect(car1.speedKmh).toBeGreaterThan(20)
    expect(latest.find((p) => p.carId === 'c2')!.speedKmh).toBe(0)
  })

  it('keeps trip distance within 2% of the generated route', async () => {
    const ds = createMockDataSource({ now: () => NOW })
    const trips = await ds.getTrips(null, TODAY - 30 * DAY, NOW + 1)
    for (const trip of trips) {
      const end = trip.endTime ?? NOW + 1
      const route = (await ds.getRoute(trip.carId, trip.startTime, end + 1)).filter((p) => p.fixTime <= end)
      if (route.length < 2) continue
      const len = routeLength(route)
      expect(Math.abs(trip.distanceM - len)).toBeLessThanOrEqual(len * 0.02 + 1)
    }
  })

  it('has a 6 minute signal gap for c2 today, inside the trip', async () => {
    const ds = createMockDataSource({ now: () => NOW })
    const [trip] = await ds.getTrips('c2', TODAY, NOW + 1)
    const route = await ds.getRoute('c2', trip.startTime, trip.endTime! + 1)
    const gaps: SignalGap[] = []
    for (let i = 1; i < route.length; i++) {
      const dt = route[i].fixTime - route[i - 1].fixTime
      if (dt > config.noSignalMs) gaps.push({ carId: 'c2', startTime: route[i - 1].fixTime, endTime: route[i].fixTime, durationMs: dt })
    }
    expect(gaps).toHaveLength(1)
    expect(gaps[0].durationMs).toBe(6 * MINUTE)
    expect(gaps[0].startTime).toBeGreaterThan(trip.startTime)
    expect(gaps[0].endTime).toBeLessThan(trip.endTime!)
    expect(route.some((p) => p.fixTime > gaps[0].startTime && p.fixTime < gaps[0].endTime)).toBe(false)
    // Parked fixes before and after the trip are never more than 5 minutes apart.
    const day = await ds.getRoute('c2', TODAY, NOW + 1)
    const longBreaks = day.filter((p, i) => i > 0 && p.fixTime - day[i - 1].fixTime > config.noSignalMs)
    expect(longBreaks).toHaveLength(1)
  })

  it('returns one fix per car at or before now', async () => {
    const ds = createMockDataSource({ now: () => NOW + 7_000 })
    const latest = await ds.getLatestPositions()
    expect(latest.map((p) => p.carId).sort()).toEqual(['c1', 'c2'])
    for (const p of latest) {
      expect(p.fixTime).toBeLessThanOrEqual(NOW + 7_000)
      expect(NOW + 7_000 - p.fixTime).toBeLessThan(config.noSignalMs)
    }
  })

  it('trims gracefully early in the day', async () => {
    for (const minutes of [0, 1, 20, 90, 200]) {
      const now = TODAY + minutes * MINUTE + 5_000
      const ds = createMockDataSource({ now: () => now })
      const trips = await ds.getTrips(null, TODAY, now + 1)
      for (const t of trips) {
        expect(t.startTime).toBeGreaterThanOrEqual(TODAY)
        expect(t.endTime ?? now).toBeLessThanOrEqual(now)
      }
      const route = await ds.getRoute('c1', TODAY, now + 1)
      for (const p of route) {
        expect(p.fixTime).toBeGreaterThanOrEqual(TODAY)
        expect(p.fixTime).toBeLessThanOrEqual(now)
      }
      expect(await ds.getLatestPositions()).toHaveLength(2)
    }
  })

  it('emits live positions and stops after unsubscribe', () => {
    vi.useFakeTimers()
    let clock = NOW
    const ds = createMockDataSource({ now: () => clock, tickMs: 2000 })
    const batches: Position[][] = []
    const received: number[] = []
    const stop = ds.subscribe({
      onPositions: (p) => batches.push(p),
      onMessage: (t) => received.push(t),
    })
    for (let i = 0; i < 5; i++) {
      clock += 2000
      vi.advanceTimersByTime(2000)
    }
    expect(batches.length).toBe(5)
    expect(received).toEqual([NOW + 2000, NOW + 4000, NOW + 6000, NOW + 8000, NOW + 10000])
    const c1 = batches.flat().filter((p) => p.carId === 'c1')
    expect(c1).toHaveLength(5)
    expect(c1.every((p) => p.motion)).toBe(true)
    // The parked car only sends a heartbeat now and then.
    expect(batches.flat().filter((p) => p.carId === 'c2').length).toBe(1)
    clock += 30_000
    vi.advanceTimersByTime(30_000)
    expect(batches.flat().filter((p) => p.carId === 'c2').length).toBeGreaterThanOrEqual(2)
    stop()
    const count = batches.length
    clock += 20_000
    vi.advanceTimersByTime(20_000)
    expect(batches.length).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('live feed with a signal gap', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds a car back during the gap, then releases a late out-of-order burst', () => {
    vi.useFakeTimers()
    let clock = 0
    const gap: SignalGap = { carId: 'a', startTime: 10_000, endTime: 20_000, durationMs: 10_000 }
    const fix = (t: number): Position => ({ carId: 'a', fixTime: t, lat: 0, lon: 0, speedKmh: 40, course: 0, motion: true })
    const stored = Array.from({ length: 12 }, (_, i) => fix(20_000 + i * 10_000))
    const batches: Position[][] = []
    const stop = startFeed(
      {
        now: () => clock,
        carIds: ['a'],
        gaps: [gap],
        positionAt: (_id, t) => fix(t),
        fixesBetween: (_id, from, to) => stored.filter((p) => p.fixTime >= from && p.fixTime <= to),
      },
      { onPositions: (p) => batches.push(p) },
      2000,
    )
    const run = (until: number) => {
      while (clock < until) {
        clock += 2000
        vi.advanceTimersByTime(2000)
      }
    }
    run(10_000)
    const before = batches.length
    expect(before).toBeGreaterThan(0)
    run(20_000 + BUFFER_RELEASE_MS - 2000)
    // Nothing was sent while the gap (and its buffering) lasted.
    expect(batches.length).toBe(before)
    run(20_000 + BUFFER_RELEASE_MS)
    expect(batches.length).toBe(before + 1)
    const burst = batches[batches.length - 1].map((p) => p.fixTime)
    expect(burst.length).toBeGreaterThan(3)
    expect(burst.slice(1)).toEqual(burst.slice(1).sort((x, y) => y - x))
    expect(burst).not.toEqual(burst.slice().sort((x, y) => x - y))
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('trip helpers', () => {
  it('uses stable ids per car and start', async () => {
    const a = await createMockDataSource({ now: () => NOW }).getTrips(null, TODAY, NOW + 1)
    const b = await createMockDataSource({ now: () => NOW }).getTrips(null, TODAY, NOW + 1)
    expect(a.map((t: Trip) => t.id)).toEqual(b.map((t: Trip) => t.id))
    expect(new Set(a.map((t) => t.id)).size).toBe(a.length)
  })
})

describe('mock history realism', () => {
  const ds = createMockDataSource({ now: () => NOW })
  const FROM = addDays(TODAY, -29)
  /** Finished trips of the 29 whole days before today. */
  async function history() {
    const trips = (await ds.getTrips(null, FROM, TODAY)).filter((t) => t.startTime >= FROM)
    const days = Array.from({ length: 29 }, (_, i) => addDays(FROM, i))
    return { trips, days }
  }
  const dayTrips = (trips: Trip[], carId: string, day: number) =>
    trips.filter((t) => t.carId === carId && t.startTime >= day && t.startTime < addDays(day, 1))

  it('spreads daily distance per car from nothing up to about 110 km', async () => {
    const { trips, days } = await history()
    const km = ['c1', 'c2'].flatMap((c) => days.map((d) => dayTrips(trips, c, d).reduce((s, t) => s + t.distanceM, 0) / 1000))
    const active = km.filter((x) => x > 0)
    expect(Math.max(...km)).toBeLessThanOrEqual(115)
    expect(Math.min(...active)).toBeLessThan(20)
    expect(Math.max(...km)).toBeGreaterThan(80)
    expect(km.filter((x) => x === 0).length).toBeGreaterThan(3)
    // Not blocky: many different 10 km bands are used.
    expect(new Set(active.map((x) => Math.floor(x / 10))).size).toBeGreaterThanOrEqual(7)
  })

  it('mixes long drives, errands and several trips a day', async () => {
    const { trips, days } = await history()
    const lengths = trips.map((t) => t.distanceM / 1000)
    expect(lengths.filter((l) => l < 15).length).toBeGreaterThan(5) // local hops
    expect(lengths.filter((l) => l > 60).length).toBeGreaterThan(0) // Town depot <-> Supplier yard
    const titles = new Set(trips.map((t) => `${t.startPlace} > ${t.endPlace}`))
    for (const pair of ['Site > Town depot', 'Town depot > Site', 'Supplier yard > Site', 'Site > Supplier yard']) expect(titles.has(pair)).toBe(true)
    expect(titles.has('Supplier yard > Town depot') || titles.has('Town depot > Supplier yard')).toBe(true)
    expect([...titles].some((x) => x.includes('null'))).toBe(true) // errands to unnamed places
    expect(titles.size).toBeGreaterThanOrEqual(8)
    const perDay = ['c1', 'c2'].flatMap((c) => days.map((d) => dayTrips(trips, c, d).length))
    expect(Math.max(...perDay)).toBe(4)
    expect(perDay.filter((n) => n >= 3).length).toBeGreaterThan(3)
  })

  it('is quieter at weekends', async () => {
    const { trips, days } = await history()
    const share = (weekend: boolean) => {
      const rows = days.filter((d) => [0, 6].includes(localWeekday(d + 12 * HOUR, config.timezone)) === weekend)
      const cells = rows.flatMap((d) => ['c1', 'c2'].map((c) => dayTrips(trips, c, d).length))
      return { idle: cells.filter((n) => n === 0).length / cells.length, avg: cells.reduce((a, b) => a + b, 0) / cells.length }
    }
    expect(share(true).idle).toBeGreaterThan(share(false).idle)
    expect(share(true).avg).toBeLessThan(share(false).avg)
  })

  it('puts a few minutes of stops inside trips, never inside a short hop', async () => {
    const { trips } = await history()
    expect(trips.filter((t) => t.stops.length > 0).length).toBeGreaterThan(10)
    for (const t of trips) {
      for (const s of t.stops) {
        expect(s.startTime).toBeGreaterThan(t.startTime)
        expect(s.endTime).toBeLessThan(t.endTime!)
        expect(s.durationMs).toBeGreaterThanOrEqual(2 * MINUTE)
        expect(s.durationMs).toBeLessThanOrEqual(12 * MINUTE)
      }
      if (t.drivingMs < 12 * MINUTE) expect(t.stops).toHaveLength(0)
    }
  })

  it('has a few signal gaps on older days and no fix inside any of them', async () => {
    const { trips } = await history()
    const gaps: SignalGap[] = []
    for (const carId of ['c1', 'c2']) {
      const route = await ds.getRoute(carId, FROM, TODAY)
      const mine = findSignalGaps(carId, route, trips)
      for (const g of mine) {
        expect(route.some((p) => p.fixTime > g.startTime && p.fixTime < g.endTime)).toBe(false)
        expect(trips.some((t) => t.carId === carId && t.startTime < g.startTime && g.endTime < t.endTime!)).toBe(true)
      }
      gaps.push(...mine)
    }
    expect(gaps.length).toBeGreaterThanOrEqual(2)
    expect(gaps.length).toBeLessThanOrEqual(12)
    for (const g of gaps) expect(g.durationMs).toBeGreaterThan(config.noSignalMs)
  })

  it('keeps its invariants on other days too', async () => {
    for (const now of [NOW + 3 * DAY, NOW - 40 * DAY + 5 * HOUR, Date.UTC(2027, 2, 14, 2, 0)]) {
      const other = createMockDataSource({ now: () => now })
      const from = addDays(localDayStart(now, config.timezone), -29)
      const all = await other.getTrips(null, from, now + 1)
      expect(all.filter((t) => t.endTime === null).map((t) => t.carId)).toEqual(['c1'])
      for (const row of await other.getSummary(from, now + 1)) {
        const mine = all.filter((t) => t.carId === row.carId)
        expect(row.distanceM).toBe(mine.reduce((s, t) => s + t.distanceM, 0))
        expect(row.tripCount).toBe(mine.length)
      }
      for (const t of all) {
        if (t.endTime === null) continue
        const route = await other.getRoute(t.carId, t.startTime, t.endTime + 1)
        let len = 0
        for (let i = 1; i < route.length; i++) len += haversineM(route[i - 1].lat, route[i - 1].lon, route[i].lat, route[i].lon)
        expect(Math.abs(t.distanceM - len)).toBeLessThanOrEqual(len * 0.02 + 1)
      }
    }
  })

  it('keeps every errand stop outside the geofences', () => {
    for (const w of WAYPOINTS) {
      expect(placeAt(w.centre[0], w.centre[1])).toBeNull()
      for (const p of PLACES) expect(haversineM(w.centre[0], w.centre[1], p.centre[0], p.centre[1])).toBeGreaterThan(2500)
    }
  })

  it('builds the whole world and a 30 day view quickly', async () => {
    const t0 = performance.now()
    const fresh = createMockDataSource({ now: () => NOW + 12 * HOUR })
    await fresh.getTrips(null, FROM, NOW + 12 * HOUR)
    await fresh.getRoute('c1', FROM, NOW + 12 * HOUR)
    await fresh.getRoute('c2', FROM, NOW + 12 * HOUR)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
