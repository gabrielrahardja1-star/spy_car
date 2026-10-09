// OWNED BY: hooks agent. React bindings over a DataSource. Screens import ONLY from here (and types/format).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Car, Geofence, LiveCar, Position, SignalGap, Summary, Trip } from './types'
import { config } from '../config'
import { findSignalGaps, toLiveCar } from './derive'
import { useDataSource, useLiveStore } from './DataProvider'

export type Async<T> = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T }

const LOADING: Async<never> = { status: 'loading' }
/** How much history the live view loads per car; enough to work out "parked for". */
const LIVE_HISTORY_MS = 2 * 60 * 60 * 1000
const TRIPS_REFRESH_MS = 15_000
/** How far back the live view looks for a car's last finished trip, to know how long it has been parked. */
const LAST_TRIP_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'Unknown error')
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

interface AsyncOptions {
  /** Refetch interval. Background refetches keep the previous data and ignore failures. */
  refreshMs?: number
  /** Checked before each background refetch. */
  refreshWhile?: () => boolean
}

/**
 * Runs `fn` whenever `deps` change. Returns 'loading' as soon as deps change (never data of another key),
 * ignores responses from superseded runs, and maps any throw to {status:'error'}.
 */
function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[], opts?: AsyncOptions): Async<T> {
  const [state, setState] = useState<{ deps: readonly unknown[]; result: Async<T> }>(() => ({ deps, result: LOADING }))

  useEffect(() => {
    let cancelled = false
    let seq = 0
    const run = (background: boolean) => {
      const mine = ++seq
      new Promise<T>((resolve) => resolve(fn())).then(
        (data) => {
          if (!cancelled && mine === seq) setState({ deps, result: { status: 'ready', data } })
        },
        (e: unknown) => {
          if (!cancelled && mine === seq && !background) setState({ deps, result: { status: 'error', error: toError(e) } })
        },
      )
    }
    run(false)
    const timer = opts?.refreshMs
      ? setInterval(() => {
          if (opts.refreshWhile?.() ?? true) run(true)
        }, opts.refreshMs)
      : undefined
    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return sameDeps(state.deps, deps) ? state.result : LOADING
}

/** Current time in ms; re-renders every `intervalMs` (default 1000). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useCars(): Async<Car[]> {
  const source = useDataSource()
  return useAsync(() => source.getCars(), [source])
}

export function useGeofences(): Async<Geofence[]> {
  const source = useDataSource()
  return useAsync(() => source.getGeofences(), [source])
}

/** Latest position per car + live updates, status/age recomputed every second. Order follows useCars. */
export function useLiveCars(): Async<LiveCar[]> {
  const source = useDataSource()
  const store = useLiveStore()

  // Initial load: cars, latest fixes, and a short history per car. Everything goes into the shared buffer.
  const boot = useAsync(async () => {
    const [cars, latest] = await Promise.all([source.getCars(), source.getLatestPositions()])
    const to = Date.now() + 1
    const [routes, trips] = await Promise.all([
      Promise.all(cars.map((c) => source.getRoute(c.id, to - LIVE_HISTORY_MS, to))),
      Promise.all(cars.map((c) => source.getTrips(c.id, to - LAST_TRIP_LOOKBACK_MS, to))),
    ])
    store.merge([...routes.flat(), ...latest])
    // End of each car's most recent finished trip: the start of its current parked period.
    const lastTripEnd = new Map<string, number>()
    cars.forEach((c, i) => {
      const ends = trips[i].flatMap((t) => (t.endTime === null ? [] : [t.endTime]))
      if (ends.length > 0) lastTripEnd.set(c.id, Math.max(...ends))
    })
    return { cars, lastTripEnd }
  }, [source, store])

  const version = useSyncExternalStore(store.subscribe, store.getVersion)
  const now = useNow()

  return useMemo<Async<LiveCar[]>>(() => {
    if (boot.status !== 'ready') return boot
    const { cars, lastTripEnd } = boot.data
    return {
      status: 'ready',
      data: cars.map((car) => {
        const buffer = store.getBuffer(car.id)
        const live = toLiveCar(car, buffer, now)
        // The buffer only holds a couple of hours. If the car never moved in it, "parked for" from the buffer
        // is just a lower bound, so measure from the end of its last finished trip instead.
        const endedAt = lastTripEnd.get(car.id)
        const movedInBuffer = buffer.some((p) => p.motion || p.speedKmh > config.movingKmh)
        if (live.parkedForMs !== null && !movedInBuffer && endedAt !== undefined) {
          return { ...live, parkedForMs: Math.max(live.parkedForMs, now - endedAt) }
        }
        return live
      }),
    }
    // `version` invalidates the memo when the buffer changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, store, version, now])
}

/** ms epoch of the most recent live message received, or null before the first. Drives the "updated N s ago" chip. */
export function useLastMessageAt(): number | null {
  const store = useLiveStore()
  return useSyncExternalStore(store.subscribe, store.getLastMessageAt)
}

/** Trips for a range, newest first. Refetches every 15 s while `to` is in the future. */
export function useTrips(carId: string | null, from: number, to: number): Async<Trip[]> {
  const source = useDataSource()
  return useAsync(() => source.getTrips(carId, from, to), [source, carId, from, to], {
    refreshMs: TRIPS_REFRESH_MS,
    refreshWhile: () => to > Date.now(),
  })
}

/** Route for one car in a range. carId null (nothing selected yet) resolves to an empty route without a request. */
export function useRoute(carId: string | null, from: number, to: number): Async<Position[]> {
  const source = useDataSource()
  return useAsync(() => (carId === null ? Promise.resolve([]) : source.getRoute(carId, from, to)), [source, carId, from, to])
}

/** Signal gaps for a range (route + trips -> findSignalGaps). carId null = both cars. */
export function useSignalGaps(carId: string | null, from: number, to: number): Async<SignalGap[]> {
  const source = useDataSource()
  return useAsync(
    async () => {
      const [carIds, trips] = await Promise.all([
        carId === null ? source.getCars().then((cars) => cars.map((c) => c.id)) : Promise.resolve([carId]),
        source.getTrips(carId, from, to),
      ])
      const perCar = await Promise.all(
        carIds.map(async (id) =>
          findSignalGaps(
            id,
            await source.getRoute(id, from, to),
            trips.filter((t) => t.carId === id),
          ),
        ),
      )
      return perCar.flat().sort((a, b) => a.startTime - b.startTime)
    },
    [source, carId, from, to],
  )
}

export function useSummary(from: number, to: number): Async<Summary[]> {
  const source = useDataSource()
  return useAsync(() => source.getSummary(from, to), [source, from, to])
}
