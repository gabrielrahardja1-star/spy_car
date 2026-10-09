import { describe, expect, it } from 'vitest'
import type { Config } from '../config'
import {
  buildHourStrip,
  carStatus,
  describeStrip,
  distancePerDay,
  findSignalGaps,
  knotsToKmh,
  openSignalGap,
  parkedForMs,
  sortPositions,
  stopsOf,
  summarizeTrips,
  toLiveCar,
} from './derive'
import { dayBounds } from './format'
import type { Car, Position, SignalGap, Stop, Trip } from './types'

const MIN = 60_000
const H = 3_600_000
const MAK = 'Asia/Makassar'
const utc = (s: string) => Date.parse(s)
/** Local Makassar wall time on 8 Oct 2026 -> instant. */
const at = (hhmm: string, day = '2026-10-08') => Date.parse(`${day}T${hhmm}:00+08:00`)

const cfg: Config = {
  timezone: MAK,
  movingKmh: 3,
  noSignalMs: 5 * MIN,
  workdayStartHour: 6,
  workdayEndHour: 18,
  dataSource: 'mock',
  traccarUrl: '',
  siteGeofenceName: 'Site',
  minPauseMs: 2 * MIN,
  pauseDeriveMaxRangeMs: 2 * 24 * H,
}

const pos = (fixTime: number, o: Partial<Position> = {}): Position => ({
  carId: 'c1',
  fixTime,
  lat: 0,
  lon: 0,
  speedKmh: 0,
  course: 0,
  motion: false,
  ...o,
})

const stop = (startTime: number, endTime: number, carId = 'c1'): Stop => ({
  carId,
  startTime,
  endTime,
  durationMs: endTime - startTime,
  lat: 0,
  lon: 0,
  place: null,
})

const trip = (id: string, startTime: number, endTime: number | null, o: Partial<Trip> = {}): Trip => ({
  id,
  carId: 'c1',
  startTime,
  endTime,
  startPlace: null,
  endPlace: null,
  distanceM: 0,
  drivingMs: 0,
  maxSpeedKmh: 0,
  stops: [],
  ...o,
})

describe('knotsToKmh', () => {
  it('multiplies by 1.852', () => {
    expect(knotsToKmh(10)).toBeCloseTo(18.52, 6)
    expect(knotsToKmh(0)).toBe(0)
  })
})

describe('sortPositions', () => {
  it('sorts by fixTime without mutating and drops duplicates', () => {
    const input = [pos(300), pos(100), pos(200), pos(100), pos(100, { carId: 'c2' })]
    const copy = input.slice()
    const out = sortPositions(input)
    expect(out.map((p) => `${p.carId}${p.fixTime}`)).toEqual(['c1100', 'c2100', 'c1200', 'c1300'])
    expect(input).toEqual(copy)
  })
})

describe('carStatus', () => {
  const now = at('12:00')
  it('no position is nosignal', () => {
    expect(carStatus(null, now, cfg)).toBe('nosignal')
  })
  it('a fix 5 min old is fresh, 5 min 1 ms is nosignal', () => {
    expect(carStatus(pos(now - 5 * MIN), now, cfg)).toBe('parked')
    expect(carStatus(pos(now - 5 * MIN - 1), now, cfg)).toBe('nosignal')
    expect(carStatus(pos(now - 5 * MIN - 1, { speedKmh: 50, motion: true }), now, cfg)).toBe('nosignal')
  })
  it('moving by speed or by motion flag; speed must exceed the threshold', () => {
    expect(carStatus(pos(now, { speedKmh: 3.1 }), now, cfg)).toBe('moving')
    expect(carStatus(pos(now, { speedKmh: 3 }), now, cfg)).toBe('parked')
    expect(carStatus(pos(now, { motion: true }), now, cfg)).toBe('moving')
  })
  it('a future fix counts as age 0', () => {
    expect(carStatus(pos(now + 10 * MIN), now, cfg)).toBe('parked')
  })
  it('respects config overrides', () => {
    const c = { ...cfg, noSignalMs: MIN, movingKmh: 10 }
    expect(carStatus(pos(now - 2 * MIN), now, c)).toBe('nosignal')
    expect(carStatus(pos(now, { speedKmh: 5 }), now, c)).toBe('parked')
  })
})

describe('parkedForMs', () => {
  const now = at('12:00')
  it('measures from the first parked fix after the last moving fix (any input order)', () => {
    const history = [
      pos(now - 60 * MIN, { speedKmh: 40 }),
      pos(now - 50 * MIN, { speedKmh: 30 }),
      pos(now - 40 * MIN), // first parked fix after moving
      pos(now - 20 * MIN),
      pos(now - 2 * MIN),
    ]
    expect(parkedForMs(history, now, cfg)).toBe(40 * MIN)
    expect(parkedForMs(history.slice().reverse(), now, cfg)).toBe(40 * MIN)
  })
  it('uses the last moving run when the car moved several times', () => {
    const history = [pos(now - 90 * MIN), pos(now - 80 * MIN, { motion: true }), pos(now - 30 * MIN), pos(now - MIN)]
    expect(parkedForMs(history, now, cfg)).toBe(30 * MIN)
  })
  it('never moved: measures from the first fix', () => {
    expect(parkedForMs([pos(now - 3 * MIN), pos(now - 30 * MIN), pos(now - MIN)], now, cfg)).toBe(30 * MIN)
  })
  it('null when moving, no signal or empty', () => {
    expect(parkedForMs([pos(now - MIN), pos(now, { speedKmh: 20 })], now, cfg)).toBeNull()
    expect(parkedForMs([pos(now - 6 * MIN)], now, cfg)).toBeNull()
    expect(parkedForMs([], now, cfg)).toBeNull()
  })
})

describe('toLiveCar', () => {
  const car: Car = { id: 'c1', name: 'Car 01', driver: '[Driver name]' }
  const now = at('12:00')
  it('combines status, last seen and parked for', () => {
    const recent = [pos(now - 2 * MIN), pos(now - 30 * MIN, { speedKmh: 20 }), pos(now - 20 * MIN)]
    const live = toLiveCar(car, recent, now, cfg)
    expect(live.car).toBe(car)
    expect(live.position?.fixTime).toBe(now - 2 * MIN)
    expect(live.status).toBe('parked')
    expect(live.lastSeenMs).toBe(2 * MIN)
    expect(live.parkedForMs).toBe(20 * MIN)
  })
  it('moving car has no parkedFor', () => {
    const live = toLiveCar(car, [pos(now - 1000, { speedKmh: 30 })], now, cfg)
    expect(live.status).toBe('moving')
    expect(live.parkedForMs).toBeNull()
    expect(live.lastSeenMs).toBe(1000)
  })
  it('no signal keeps counting last seen and is never parked', () => {
    const live = toLiveCar(car, [pos(now - 20 * MIN)], now, cfg)
    expect(live.status).toBe('nosignal')
    expect(live.lastSeenMs).toBe(20 * MIN)
    expect(live.parkedForMs).toBeNull()
  })
  it('no position at all', () => {
    const live = toLiveCar(car, [], now, cfg)
    expect(live).toMatchObject({ position: null, status: 'nosignal', lastSeenMs: null, parkedForMs: null })
  })
})

describe('findSignalGaps', () => {
  const t0 = at('09:00')
  const t = trip('t1', t0, t0 + 60 * MIN)
  it('finds gaps longer than the threshold inside a trip, from unsorted input', () => {
    const fixes = [
      pos(t0 + 30 * MIN),
      pos(t0),
      pos(t0 + 3 * MIN),
      pos(t0 + 12 * MIN), // 9 min gap from t0 + 3
      pos(t0 + 20 * MIN), // 8 min gap
      pos(t0 + 24 * MIN),
      pos(t0 + 60 * MIN), // 6 min and 30 min gaps from 24 and 30
    ]
    const gaps = findSignalGaps('c1', fixes, [t], cfg)
    expect(gaps).toEqual([
      { carId: 'c1', startTime: t0 + 3 * MIN, endTime: t0 + 12 * MIN, durationMs: 9 * MIN },
      { carId: 'c1', startTime: t0 + 12 * MIN, endTime: t0 + 20 * MIN, durationMs: 8 * MIN },
      { carId: 'c1', startTime: t0 + 24 * MIN, endTime: t0 + 30 * MIN, durationMs: 6 * MIN },
      { carId: 'c1', startTime: t0 + 30 * MIN, endTime: t0 + 60 * MIN, durationMs: 30 * MIN },
    ])
  })
  it('a delta of exactly the threshold is not a gap', () => {
    expect(findSignalGaps('c1', [pos(t0), pos(t0 + 5 * MIN)], [t], cfg)).toEqual([])
  })
  it('ignores gaps outside any trip (parked) and other cars', () => {
    const fixes = [pos(t0 + 70 * MIN), pos(t0 + 200 * MIN), pos(t0, { carId: 'c2' }), pos(t0 + 30 * MIN, { carId: 'c2' })]
    expect(findSignalGaps('c1', fixes, [t], cfg)).toEqual([])
  })
  it('an in-progress trip extends to the last fix', () => {
    const open = trip('t2', t0, null)
    const gaps = findSignalGaps('c1', [pos(t0), pos(t0 + 2 * MIN), pos(t0 + 40 * MIN)], [open], cfg)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].durationMs).toBe(38 * MIN)
  })
  it('too few fixes', () => {
    expect(findSignalGaps('c1', [pos(t0)], [t], cfg)).toEqual([])
  })
})

describe('summarizeTrips / stopsOf', () => {
  const trips = [
    trip('a', at('07:00'), at('08:00'), { distanceM: 10_000, drivingMs: 50 * MIN, stops: [stop(at('07:20'), at('07:25'))] }),
    trip('b', at('09:00'), null, { distanceM: 3_500, drivingMs: 20 * MIN, stops: [stop(at('09:10'), at('09:15')), stop(at('09:30'), at('09:31'))] }),
    trip('c', at('09:00'), at('10:00'), { carId: 'c2', distanceM: 999_000 }),
  ]
  it('totals one car', () => {
    expect(summarizeTrips('c1', trips)).toEqual({
      carId: 'c1',
      distanceM: 13_500,
      drivingMs: 70 * MIN,
      tripCount: 2,
      stopCount: 3,
      inProgressCount: 1,
    })
  })
  it('empty gives zeros', () => {
    expect(summarizeTrips('c9', trips)).toEqual({ carId: 'c9', distanceM: 0, drivingMs: 0, tripCount: 0, stopCount: 0, inProgressCount: 0 })
  })
  it('stopsOf flattens oldest first', () => {
    const out = stopsOf([trips[1], trips[0]])
    expect(out.map((s) => s.startTime)).toEqual([at('07:20'), at('09:10'), at('09:30')])
    expect(stopsOf([])).toEqual([])
  })
})

describe('distancePerDay', () => {
  it('buckets by local start day, zero for empty days', () => {
    const d8 = dayBounds(at('12:00'), MAK).start
    const d7 = d8 - 24 * H
    const d6 = d7 - 24 * H
    const trips = [
      trip('a', at('00:30'), at('01:00'), { distanceM: 1000 }), // 00:30 local is the 7th in UTC: must count on the 8th
      trip('b', at('23:50', '2026-10-07'), at('00:20'), { distanceM: 400 }), // starts on the 7th, ends on the 8th
      trip('c', at('08:00'), at('09:00'), { distanceM: 2000 }),
    ]
    expect(distancePerDay(trips, [d6, d7, d8], MAK)).toEqual([0, 400, 3000])
  })
  it('works on a DST day', () => {
    const tz = 'Europe/Berlin'
    const day = dayBounds(utc('2026-03-29T10:00:00Z'), tz).start
    const trips = [trip('a', utc('2026-03-28T23:30:00Z'), null, { distanceM: 5 }), trip('b', utc('2026-03-29T21:59:00Z'), null, { distanceM: 7 }), trip('c', utc('2026-03-29T22:00:00Z'), null, { distanceM: 100 })]
    expect(distancePerDay(trips, [day], tz)).toEqual([12])
  })
})

describe('buildHourStrip', () => {
  const dayStart = dayBounds(at('12:00'), MAK).start
  const kinds = (s: { kind: string }[]) => s.map((x) => x.kind)

  it('reproduces the Car 02 mockup row', () => {
    const gap: SignalGap = { carId: 'c1', startTime: at('12:58'), endTime: at('13:04'), durationMs: 6 * MIN }
    const trips = [trip('t', at('12:25'), at('13:40'))]
    const strip = buildHourStrip({ dayStart, now: at('14:18'), trips, gaps: [gap], cfg })
    expect(kinds(strip)).toEqual(['parked', 'moving', 'nosignal', 'moving', 'parked'])
    const widths = strip.map((s) => s.widthPct)
    const expected = [53.5, 4.6, 0.8, 5, 5.3]
    widths.forEach((w, i) => expect(w).toBeCloseTo(expected[i], 0))
    expect(strip.map((s) => s.title)).toEqual([
      'Parked 06:00 to 12:25',
      'Moving 12:25 to 12:58',
      'No signal 12:58 to 13:04',
      'Moving 13:04 to 13:40',
      'Parked 13:40 to now',
    ])
    // contiguous and clipped at now; sum < 100 mid-day
    expect(strip[0].startTime).toBe(at('06:00'))
    expect(strip[4].endTime).toBe(at('14:18'))
    strip.slice(1).forEach((s, i) => expect(s.startTime).toBe(strip[i].endTime))
    const sum = widths.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo((8 * 60 + 18) / 720 * 100, 6)
  })

  it('splits trips at stops, uses duration titles for short segments and ends an open trip at now', () => {
    const trips = [
      trip('t1', at('07:42'), at('09:05'), { stops: [stop(at('07:58'), at('08:01')), stop(at('08:36'), at('08:44'))] }),
      trip('t2', at('13:20'), null),
    ]
    const strip = buildHourStrip({ dayStart, now: at('15:00'), trips, gaps: [], cfg })
    expect(strip.map((s) => s.title)).toEqual([
      'Parked 06:00 to 07:42',
      'Moving 07:42 to 07:58',
      'Parked 3 min',
      'Moving 08:01 to 08:36',
      'Parked 8 min',
      'Moving 08:44 to 09:05',
      'Parked 09:05 to 13:20',
      'Moving 13:20 to now',
    ])
    expect(strip[2].widthPct).toBeCloseTo((3 / 720) * 100, 6)
  })

  it('nosignal wins over moving and parked; adjacent same-kind segments merge', () => {
    const trips = [trip('t1', at('08:00'), at('09:00')), trip('t2', at('09:00'), at('10:00'))]
    const gaps: SignalGap[] = [{ carId: 'c1', startTime: at('09:30'), endTime: at('11:00'), durationMs: 90 * MIN }]
    const strip = buildHourStrip({ dayStart, now: at('18:30'), trips, gaps, cfg })
    expect(kinds(strip)).toEqual(['parked', 'moving', 'nosignal', 'parked'])
    expect(strip[1]).toMatchObject({ startTime: at('08:00'), endTime: at('09:30') })
    expect(strip[3].endTime).toBe(at('18:00')) // past the workday end: not "now"
    expect(strip[3].title).toBe('Parked 11:00 to 18:00')
  })

  it('past full day sums to 100; before the workday or a future day draws nothing', () => {
    const full = buildHourStrip({ dayStart, now: at('23:00'), trips: [], gaps: [], cfg })
    expect(full).toHaveLength(1)
    expect(full[0].widthPct).toBeCloseTo(100, 9)
    expect(buildHourStrip({ dayStart, now: at('05:59'), trips: [], gaps: [], cfg })).toEqual([])
    expect(buildHourStrip({ dayStart, now: at('06:00'), trips: [], gaps: [], cfg })).toEqual([])
  })

  it('clips a trip that started before the workday', () => {
    const trips = [trip('t', at('05:00', '2026-10-08'), at('07:00'))]
    const strip = buildHourStrip({ dayStart, now: at('09:00'), trips, gaps: [], cfg })
    expect(strip[0]).toMatchObject({ kind: 'moving', startTime: at('06:00'), endTime: at('07:00') })
  })

  it('uses wall-clock workday hours on a DST day', () => {
    const berlin: Config = { ...cfg, timezone: 'Europe/Berlin' }
    const ds = dayBounds(utc('2026-03-29T10:00:00Z'), 'Europe/Berlin').start
    const strip = buildHourStrip({ dayStart: ds, now: utc('2026-03-30T00:00:00Z'), trips: [], gaps: [], cfg: berlin })
    expect(strip[0].startTime).toBe(utc('2026-03-29T04:00:00Z')) // 06:00 CEST
    expect(strip[0].endTime).toBe(utc('2026-03-29T16:00:00Z')) // 18:00 CEST
    expect(strip[0].title).toBe('Parked 06:00 to 18:00')
  })
})

describe('buildHourStrip around the workday edges', () => {
  const dayStart = dayBounds(at('12:00'), MAK).start

  it('is empty before 06:00 with no NaN, even with an overnight trip under way', () => {
    const t = trip('t', at('04:30'), null)
    for (const hhmm of ['00:00', '03:00', '05:59']) {
      const strip = buildHourStrip({ dayStart, now: at(hhmm), trips: [t], gaps: [], cfg })
      expect(strip).toEqual([])
    }
  })

  it('starts drawing right after 06:00 and every width is a finite share of the workday', () => {
    const strip = buildHourStrip({ dayStart, now: at('06:01'), trips: [], gaps: [], cfg })
    expect(strip).toHaveLength(1)
    expect(strip[0].widthPct).toBeCloseTo(100 / 720, 6)
    expect(strip[0].title).toBe('Parked 1 min')
  })

  it('after 18:00 fills the strip to exactly 100 and clips a trip still under way at 18:00', () => {
    const trips = [trip('a', at('08:00'), at('09:00')), trip('b', at('17:30'), null)]
    const strip = buildHourStrip({ dayStart, now: at('21:00'), trips, gaps: [], cfg })
    expect(strip.reduce((s, x) => s + x.widthPct, 0)).toBeCloseTo(100, 9)
    expect(strip[strip.length - 1]).toMatchObject({ kind: 'moving', startTime: at('17:30'), endTime: at('18:00') })
    expect(strip[strip.length - 1].title).toBe('Moving 17:30 to 18:00')
    expect(strip.every((x) => Number.isFinite(x.widthPct) && x.widthPct > 0)).toBe(true)
  })
})

describe('openSignalGap', () => {
  const last = at('13:40')

  it('covers the time since the last fix when the car has no signal', () => {
    expect(openSignalGap('c2', pos(last), at('14:18'), cfg)).toEqual({
      carId: 'c2',
      startTime: last,
      endTime: at('14:18'),
      durationMs: 38 * MIN,
    })
  })

  it('is null while the last fix is fresh (exactly 5 minutes old is still fresh)', () => {
    expect(openSignalGap('c1', pos(last), last + 5 * MIN, cfg)).toBeNull()
    expect(openSignalGap('c1', pos(last), last + 5 * MIN + 1, cfg)).not.toBeNull()
  })

  it('treats a car that never reported as having no signal all along', () => {
    const gap = openSignalGap('c1', null, at('14:18'), cfg)
    expect(gap).toMatchObject({ startTime: 0, endTime: at('14:18') })
    expect(Number.isFinite(gap?.durationMs)).toBe(true)
  })

  it('makes the strip show no signal instead of parked after the last fix', () => {
    const dayStart = dayBounds(at('12:00'), MAK).start
    const trips = [trip('t', at('12:25'), at('13:40'))]
    const open = openSignalGap('c1', pos(last), at('14:18'), cfg)!
    const strip = buildHourStrip({ dayStart, now: at('14:18'), trips, gaps: [open], cfg })
    expect(strip[strip.length - 1]).toMatchObject({ kind: 'nosignal', startTime: last, endTime: at('14:18') })
    expect(strip[strip.length - 1].title).toBe('No signal 13:40 to now')
  })
})

describe('describeStrip', () => {
  const dayStart = dayBounds(at('12:00'), MAK).start

  it('lists every segment with its times, ending in "now"', () => {
    const gap: SignalGap = { carId: 'c1', startTime: at('12:58'), endTime: at('13:04'), durationMs: 6 * MIN }
    const strip = buildHourStrip({ dayStart, now: at('14:18'), trips: [trip('t', at('12:25'), at('13:40'))], gaps: [gap], cfg })
    expect(describeStrip(strip, at('14:18'), MAK)).toBe(
      'Parked 06:00 to 12:25, Moving 12:25 to 12:58, No signal 12:58 to 13:04, Moving 13:04 to 13:40, Parked 13:40 to now',
    )
  })

  it('says so when there is nothing to show yet, and does not say "now" after the workday', () => {
    expect(describeStrip([], at('05:00'), MAK)).toBe('nothing to show yet')
    const strip = buildHourStrip({ dayStart, now: at('20:00'), trips: [], gaps: [], cfg })
    expect(describeStrip(strip, at('20:00'), MAK)).toBe('Parked 06:00 to 18:00')
  })
})
