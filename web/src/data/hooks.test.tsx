import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider } from './DataProvider'
import { useCars, useLastMessageAt, useLiveCars, useNow, useSignalGaps, useTrips } from './hooks'
import type { DataSource } from './source'
import type { Car, LiveCar, Position, Trip } from './types'

// Minimal stand-ins so these tests do not depend on the real derive module.
vi.mock('./derive', () => ({
  sortPositions: (ps: Position[]) => {
    const seen = new Set<string>()
    return [...ps]
      .sort((a, b) => a.fixTime - b.fixTime)
      .filter((p) => {
        const k = `${p.carId}@${p.fixTime}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
  },
  toLiveCar: (car: Car, recent: Position[], now: number): LiveCar => {
    const position = recent.reduce<Position | null>((best, p) => (!best || p.fixTime > best.fixTime ? p : best), null)
    const lastSeenMs = position ? now - position.fixTime : null
    const status = !position || lastSeenMs! > 5 * 60_000 ? 'nosignal' : position.speedKmh > 3 ? 'moving' : 'parked'
    return { car, position, status, lastSeenMs, parkedForMs: status === 'parked' ? 0 : null }
  },
  findSignalGaps: (carId: string, positions: Position[]) =>
    positions.length ? [{ carId, startTime: positions[0].fixTime, endTime: positions[0].fixTime + 1, durationMs: 1 }] : [],
}))

const T0 = Date.UTC(2026, 9, 8, 0, 0, 0)
const CAR1: Car = { id: '1', name: 'Car 01', driver: 'A' }
const CAR2: Car = { id: '2', name: 'Car 02', driver: 'B' }
const pos = (carId: string, fixTime: number, speedKmh = 0, lat = 0): Position => ({
  carId,
  fixTime,
  lat,
  lon: 0,
  speedKmh,
  course: 0,
  motion: speedKmh > 3,
})
const trip = (id: string, carId: string): Trip => ({
  id,
  carId,
  startTime: T0,
  endTime: T0 + 1000,
  startPlace: null,
  endPlace: null,
  distanceM: 0,
  drivingMs: 0,
  maxSpeedKmh: 0,
  stops: [],
})

interface Fake extends DataSource {
  emit(positions: Position[], receivedAt?: number): void
  unsubscribe: ReturnType<typeof vi.fn>
}

function fakeSource(over: Partial<DataSource> = {}): Fake {
  let handlers: Parameters<DataSource['subscribe']>[0] | null = null
  const unsubscribe = vi.fn(() => {
    handlers = null
  })
  const src: Fake = {
    getCars: async () => [CAR1, CAR2],
    getGeofences: async () => [],
    getLatestPositions: async () => [pos('1', T0, 0), pos('2', T0, 40)],
    subscribe: vi.fn((h) => {
      handlers = h
      return unsubscribe
    }),
    getRoute: async () => [],
    getTrips: async () => [],
    getStops: async () => [],
    getSummary: async () => [],
    ...over,
    emit(positions, receivedAt = Date.now()) {
      handlers?.onPositions(positions)
      handlers?.onMessage?.(receivedAt)
    },
    unsubscribe,
  }
  return src
}

const wrap = (source: DataSource) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <DataProvider source={source}>{children}</DataProvider>
  }

const flush = () => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useNow', () => {
  it('ticks every interval and cleans up', () => {
    const { result, unmount } = renderHook(() => useNow(1000))
    expect(result.current).toBe(T0)
    act(() => void vi.advanceTimersByTime(3000))
    expect(result.current).toBe(T0 + 3000)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useAsync via useCars', () => {
  it('goes loading -> ready', async () => {
    const { result } = renderHook(() => useCars(), { wrapper: wrap(fakeSource()) })
    expect(result.current.status).toBe('loading')
    await flush()
    expect(result.current).toEqual({ status: 'ready', data: [CAR1, CAR2] })
  })

  it('maps rejections and non-Error throws to {status:"error"}', async () => {
    const a = renderHook(() => useCars(), { wrapper: wrap(fakeSource({ getCars: async () => Promise.reject(new Error('boom')) })) })
    const b = renderHook(() => useCars(), {
      wrapper: wrap(
        fakeSource({
          getCars: () => {
            throw 'plain string'
          },
        }),
      ),
    })
    await flush()
    expect(a.result.current).toMatchObject({ status: 'error', error: expect.objectContaining({ message: 'boom' }) })
    expect(b.result.current.status).toBe('error')
    if (b.result.current.status === 'error') {
      expect(b.result.current.error).toBeInstanceOf(Error)
      expect(b.result.current.error.message).toBe('plain string')
    }
  })

  it('ignores a stale response after the key changes and returns loading for the new key', async () => {
    const resolvers = new Map<string, (t: Trip[]) => void>()
    const source = fakeSource({
      getTrips: (carId) => new Promise<Trip[]>((res) => resolvers.set(String(carId), res)),
    })
    const { result, rerender } = renderHook(({ id }) => useTrips(id, T0, T0 - 1), {
      wrapper: wrap(source),
      initialProps: { id: 'a' },
    })
    rerender({ id: 'b' })
    expect(result.current.status).toBe('loading')
    await act(async () => resolvers.get('b')!([trip('tb', 'b')]))
    expect(result.current).toEqual({ status: 'ready', data: [trip('tb', 'b')] })
    // Late answer for the old key must not overwrite the new one.
    await act(async () => resolvers.get('a')!([trip('ta', 'a')]))
    expect(result.current).toEqual({ status: 'ready', data: [trip('tb', 'b')] })
  })

  it('does not return data of the previous key while the new key loads', async () => {
    const source = fakeSource({ getTrips: async (carId) => [trip(`t-${carId}`, String(carId))] })
    const { result, rerender } = renderHook(({ id }) => useTrips(id, T0, T0 - 1), {
      wrapper: wrap(source),
      initialProps: { id: 'a' },
    })
    await flush()
    expect(result.current.status).toBe('ready')
    rerender({ id: 'b' })
    expect(result.current.status).toBe('loading')
  })
})

describe('useTrips', () => {
  it('refetches in the background every 15 s while `to` is in the future, keeping the previous data', async () => {
    let calls = 0
    let release: ((t: Trip[]) => void) | null = null
    const source = fakeSource({
      getTrips: () => {
        calls++
        if (calls === 1) return Promise.resolve([trip('t1', '1')])
        return new Promise<Trip[]>((res) => (release = res))
      },
    })
    const { result } = renderHook(() => useTrips(null, T0 - 1000, T0 + 3_600_000), { wrapper: wrap(source) })
    await flush()
    expect(result.current).toMatchObject({ status: 'ready', data: [{ id: 't1' }] })

    act(() => void vi.advanceTimersByTime(15_000))
    expect(calls).toBe(2)
    expect(result.current).toMatchObject({ status: 'ready', data: [{ id: 't1' }] }) // not 'loading'

    await act(async () => release!([trip('t1', '1'), trip('t2', '1')]))
    expect(result.current).toMatchObject({ status: 'ready', data: [{ id: 't1' }, { id: 't2' }] })
  })

  it('does not refetch when `to` is in the past', async () => {
    const getTrips = vi.fn(async () => [trip('t1', '1')])
    renderHook(() => useTrips(null, T0 - 2000, T0 - 1000), { wrapper: wrap(fakeSource({ getTrips })) })
    await flush()
    act(() => void vi.advanceTimersByTime(60_000))
    expect(getTrips).toHaveBeenCalledTimes(1)
  })
})

describe('useSignalGaps', () => {
  it('runs findSignalGaps per car and sorts by startTime', async () => {
    const source = fakeSource({
      getRoute: async (carId) => [pos(carId, carId === '1' ? T0 + 500 : T0 + 100)],
      getTrips: async () => [trip('t1', '1'), trip('t2', '2')],
    })
    const { result } = renderHook(() => useSignalGaps(null, T0, T0 + 1000), { wrapper: wrap(source) })
    await flush()
    expect(result.current.status).toBe('ready')
    if (result.current.status === 'ready') expect(result.current.data.map((g) => g.carId)).toEqual(['2', '1'])
  })
})

describe('useLiveCars', () => {
  it('returns cars in getCars order with latest fixes', async () => {
    const { result } = renderHook(() => useLiveCars(), { wrapper: wrap(fakeSource()) })
    expect(result.current.status).toBe('loading')
    await flush()
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.data.map((c) => [c.car.id, c.status])).toEqual([
      ['1', 'parked'],
      ['2', 'moving'],
    ])
  })

  it('flips parked -> nosignal as time passes with no messages, and last seen keeps counting', async () => {
    const { result } = renderHook(() => useLiveCars(), { wrapper: wrap(fakeSource()) })
    await flush()
    const car1 = () => {
      if (result.current.status !== 'ready') throw new Error('not ready')
      return result.current.data[0]
    }
    expect(car1().status).toBe('parked')
    act(() => void vi.advanceTimersByTime(60_000))
    expect(car1().status).toBe('parked')
    expect(car1().lastSeenMs).toBe(60_000)
    act(() => void vi.advanceTimersByTime(5 * 60_000))
    expect(car1().status).toBe('nosignal')
    expect(car1().lastSeenMs).toBe(6 * 60_000)
  })

  it('measures "parked for" from the last finished trip when the car never moved in the recent buffer', async () => {
    const source = fakeSource({
      getLatestPositions: async () => [pos('1', T0, 0)],
      getCars: async () => [CAR1],
      getTrips: async () => [{ ...trip('t', '1'), endTime: T0 - 5 * 60 * 60_000 }],
    })
    const { result } = renderHook(() => useLiveCars(), { wrapper: wrap(source) })
    await flush()
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.data[0].parkedForMs).toBe(5 * 60 * 60_000)
  })

  it('merges live positions and a late ping does not replace a newer latest fix', async () => {
    const source = fakeSource()
    const { result } = renderHook(() => useLiveCars(), { wrapper: wrap(source) })
    await flush()
    act(() => {
      vi.advanceTimersByTime(10_000)
      source.emit([pos('1', T0 + 10_000, 30, 5)])
    })
    const latest = () => {
      if (result.current.status !== 'ready') throw new Error('not ready')
      return result.current.data[0].position
    }
    expect(latest()?.fixTime).toBe(T0 + 10_000)
    // A buffered ping from earlier arrives late.
    act(() => source.emit([pos('1', T0 + 4_000, 0, 1)]))
    expect(latest()?.fixTime).toBe(T0 + 10_000)
    expect(latest()?.lat).toBe(5)
  })

  it('seeds the buffer from recent route history and caps it', async () => {
    const getRoute = vi.fn(async (carId: string) => [pos(carId, T0 - 3000), pos(carId, T0 - 2000)])
    const source = fakeSource({ getRoute })
    const { result } = renderHook(() => useLiveCars(), { wrapper: wrap(source) })
    await flush()
    expect(getRoute).toHaveBeenCalledTimes(2)
    const [, from, to] = getRoute.mock.calls[0] as unknown as [string, number, number]
    expect(to - from).toBe(2 * 60 * 60 * 1000)
    act(() => source.emit(Array.from({ length: 700 }, (_, i) => pos('1', T0 + 1 + i))))
    if (result.current.status !== 'ready') throw new Error('not ready')
    expect(result.current.data[0].position?.fixTime).toBe(T0 + 700)
  })

  it('unsubscribes on unmount', async () => {
    const source = fakeSource()
    const { unmount } = renderHook(() => useLiveCars(), { wrapper: wrap(source) })
    await flush()
    expect(source.unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(source.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('uses a single subscription for several consumers', async () => {
    const source = fakeSource()
    renderHook(
      () => {
        useLiveCars()
        useLastMessageAt()
      },
      { wrapper: wrap(source) },
    )
    await flush()
    expect(source.subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('useLastMessageAt', () => {
  it('is null until a real message arrives, even after the initial load', async () => {
    const source = fakeSource()
    const { result } = renderHook(
      () => {
        useLiveCars()
        return useLastMessageAt()
      },
      { wrapper: wrap(source) },
    )
    await flush()
    expect(result.current).toBeNull()
    act(() => source.emit([pos('1', T0 + 1000)], T0 + 1234))
    expect(result.current).toBe(T0 + 1234)
  })

  it('works without useLiveCars mounted (e.g. the header)', () => {
    const source = fakeSource()
    const { result } = renderHook(() => useLastMessageAt(), { wrapper: wrap(source) })
    expect(result.current).toBeNull()
    act(() => source.emit([pos('1', T0)], T0 + 5))
    expect(result.current).toBe(T0 + 5)
  })
})
