import { describe, expect, it } from 'vitest'
import type { Position, Stop, Trip } from '../../data/types'
import { distanceM } from './mapGeometry'
import { distanceAlong, drivenCoordinates, positionAt, routeCoordinates, sortFixes, stopTicks, tripSpan } from './playback'

const T0 = 1_000_000
const MIN = 60_000

const fix = (fixTime: number, lon: number, lat: number, over: Partial<Position> = {}): Position => ({
  carId: 'c',
  fixTime,
  lon,
  lat,
  speedKmh: 0,
  course: 0,
  motion: true,
  ...over,
})

/** Three fixes a minute apart, heading east along the equator at 20 then 40 km/h. */
const route = [fix(T0, 0, 0, { speedKmh: 20, course: 90 }), fix(T0 + MIN, 0.01, 0, { speedKmh: 40, course: 90 }), fix(T0 + 2 * MIN, 0.02, 0, { speedKmh: 0, course: 90 })]

describe('positionAt', () => {
  it('interpolates position and speed between the fixes either side', () => {
    const p = positionAt(route, T0 + MIN / 2)
    expect(p?.lon).toBeCloseTo(0.005)
    expect(p?.lat).toBeCloseTo(0)
    expect(p?.speedKmh).toBeCloseTo(30)
    expect(positionAt(route, T0 + MIN)).toMatchObject({ lon: 0.01, speedKmh: 40 })
  })

  it('clamps before the first fix and after the last', () => {
    expect(positionAt(route, T0 - 5 * MIN)).toMatchObject({ lon: 0, speedKmh: 20 })
    expect(positionAt(route, T0 + 99 * MIN)).toMatchObject({ lon: 0.02, speedKmh: 0 })
  })

  it('gives nothing for an empty route and the only fix for a single one', () => {
    expect(positionAt([], T0)).toBeNull()
    expect(positionAt([route[1]], T0)).toMatchObject({ lon: 0.01 })
    expect(positionAt([route[1]], T0 + 5 * MIN)).toMatchObject({ lon: 0.01 })
  })

  it('sorts fixes that arrived out of order, without changing the input', () => {
    const shuffled = [route[2], route[0], route[1]]
    const copy = [...shuffled]
    expect(positionAt(shuffled, T0 + MIN / 2)?.lon).toBeCloseTo(0.005)
    expect(shuffled).toEqual(copy)
    expect(sortFixes(shuffled).map((f) => f.fixTime)).toEqual([T0, T0 + MIN, T0 + 2 * MIN])
  })

  it('turns the short way round between headings (350 to 10 passes through north)', () => {
    const turn = [fix(T0, 0, 0, { course: 350 }), fix(T0 + MIN, 0, 0, { course: 10 })]
    expect(positionAt(turn, T0 + MIN / 2)?.course).toBeCloseTo(0)
    expect(positionAt(turn, T0 + MIN / 4)?.course).toBeCloseTo(355)
    const back = [fix(T0, 0, 0, { course: 10 }), fix(T0 + MIN, 0, 0, { course: 350 })]
    expect(positionAt(back, T0 + MIN / 2)?.course).toBeCloseTo(0)
  })

  it('crosses a signal gap in a straight line', () => {
    const gap = [fix(T0, 0, 0), fix(T0 + 10 * MIN, 0.1, 0.05)]
    const mid = positionAt(gap, T0 + 5 * MIN)
    expect(mid?.lon).toBeCloseTo(0.05)
    expect(mid?.lat).toBeCloseTo(0.025)
  })

  it('handles fixes with the same time without dividing by zero', () => {
    const twin = [fix(T0, 0, 0), fix(T0, 1, 1), fix(T0 + MIN, 2, 2)]
    const p = positionAt(twin, T0)
    expect(Number.isFinite(p?.lon)).toBe(true)
    expect(Number.isFinite(positionAt(twin, T0 + MIN / 2)?.lon)).toBe(true)
  })
})

describe('distanceAlong', () => {
  const total = distanceM([0, 0], [0.02, 0])

  it('sums the straight lines between fixes up to the time, including part of a segment', () => {
    expect(distanceAlong(route, T0)).toBe(0)
    expect(distanceAlong(route, T0 + MIN)).toBeCloseTo(total / 2, 0)
    expect(distanceAlong(route, T0 + MIN * 1.5)).toBeCloseTo((total * 3) / 4, 0)
    expect(distanceAlong(route, T0 + 9 * MIN)).toBeCloseTo(total, 0)
    expect(distanceAlong(route, T0 - MIN)).toBe(0)
  })

  it('scales to the trip distance when given one', () => {
    expect(distanceAlong(route, T0 + MIN, 10_000)).toBeCloseTo(5000, 0)
    expect(distanceAlong(route, T0 + 9 * MIN, 10_000)).toBeCloseTo(10_000, 0)
  })

  it('is zero for an empty route or one that never moved', () => {
    expect(distanceAlong([], T0)).toBe(0)
    expect(distanceAlong([fix(T0, 0, 0), fix(T0 + MIN, 0, 0)], T0 + MIN, 5000)).toBe(0)
  })
})

describe('route coordinates', () => {
  it('lists the whole route in time order as [lon, lat]', () => {
    expect(routeCoordinates([route[2], route[0], route[1]])).toEqual([[0, 0], [0.01, 0], [0.02, 0]])
  })

  it('cuts the driven part at the car, ending exactly on it', () => {
    expect(drivenCoordinates(route, T0)).toEqual([[0, 0]])
    const mid = drivenCoordinates(route, T0 + MIN * 1.5)
    expect(mid).toHaveLength(3)
    expect(mid[2][0]).toBeCloseTo(0.015)
    expect(drivenCoordinates(route, T0 + MIN)).toEqual([[0, 0], [0.01, 0]])
    expect(drivenCoordinates(route, T0 + 50 * MIN)).toHaveLength(3)
    expect(drivenCoordinates([], T0)).toEqual([])
  })
})

const stop = (startMin: number, endMin: number): Stop => ({
  carId: 'c',
  startTime: T0 + startMin * MIN,
  endTime: T0 + endMin * MIN,
  durationMs: (endMin - startMin) * MIN,
  lat: 0,
  lon: 0,
  place: null,
})
const trip = (endMin: number | null, stops: Stop[] = []): Trip => ({
  id: 't',
  carId: 'c',
  startTime: T0,
  endTime: endMin === null ? null : T0 + endMin * MIN,
  startPlace: null,
  endPlace: null,
  distanceM: 0,
  drivingMs: 0,
  maxSpeedKmh: 0,
  stops,
})

describe('stopTicks', () => {
  it('places each stop start as a share of the trip, in order', () => {
    expect(stopTicks(trip(100, [stop(50, 60), stop(10, 15)]))).toEqual([0.1, 0.5])
  })

  it('keeps ticks inside the bar and copes with a zero-length trip', () => {
    expect(stopTicks(trip(10, [stop(-5, 1), stop(20, 25)]))).toEqual([0, 1])
    expect(stopTicks(trip(0, [stop(0, 1)]))).toEqual([])
    expect(stopTicks(trip(10))).toEqual([])
  })

  it('uses the given end for a trip still under way, or the last stop if none is given', () => {
    expect(stopTicks(trip(null, [stop(10, 20)]), T0 + 40 * MIN)).toEqual([0.25])
    expect(stopTicks(trip(null, [stop(10, 20)]))).toEqual([0.5])
  })
})

describe('tripSpan', () => {
  it('is the trip start to end when finished', () => {
    expect(tripSpan(trip(30), route)).toEqual({ start: T0, end: T0 + 30 * MIN })
  })

  it('runs to the newest fix for a trip under way, and is empty with no fixes', () => {
    expect(tripSpan(trip(null), [route[2], route[0]])).toEqual({ start: T0, end: T0 + 2 * MIN })
    expect(tripSpan(trip(null), [])).toEqual({ start: T0, end: T0 })
  })
})
