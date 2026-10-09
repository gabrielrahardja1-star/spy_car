// Ties history and "today" together into a view of the data as of the injected clock.
import type { Car, Geofence, Position, SignalGap, Trip } from '../types'
import { buildHistory, type History } from './history'
import { buildGeofences } from './places'
import { buildTodayPlan, CAR1, CAR2, materialize, positionAt, type TodayPlan, type TodayView } from './today'
import { localDayStart, lowerBound } from './util'

/** Today's data is rebuilt at most this often. */
const VIEW_STEP_MS = 10_000

export const CARS: Car[] = [
  { id: CAR1, name: 'Car 01', driver: '[Driver name]' },
  { id: CAR2, name: 'Car 02', driver: '[Driver name]' },
]

export interface View {
  /** Every trip, newest first. */
  trips: Trip[]
  gaps: SignalGap[]
  /** Fixes with from <= fixTime < to, ascending. */
  route(carId: string, from: number, to: number): Position[]
  latest(): Position[]
  positionAt(carId: string, t: number): Position | null
}

export interface World {
  cars: Car[]
  geofences: Geofence[]
  view(): View
}

function slice(arr: Position[], from: number, to: number): Position[] {
  const i = lowerBound(arr, from, (p) => p.fixTime)
  const j = lowerBound(arr, to, (p) => p.fixTime)
  return arr.slice(i, j)
}

export function createWorld(now: () => number, tz: string): World {
  const geofences = buildGeofences()
  let built: { dayStart: number; history: History; plan: TodayPlan } | null = null
  let cached: { key: number; view: View } | null = null

  const makeView = (history: History, plan: TodayPlan, today: TodayView): View => {
    const past = history.trips.slice().sort((a, b) => b.startTime - a.startTime)
    const trips = [...today.trips.slice().reverse(), ...past]
    return {
      trips,
      gaps: [...history.gaps, ...plan.gaps],
      route: (carId, from, to) => [...slice(history.fixes.get(carId) ?? [], from, to), ...slice(today.fixes.get(carId) ?? [], from, to)],
      latest: () =>
        CARS.flatMap((car) => {
          const todays = today.fixes.get(car.id) ?? []
          const old = history.fixes.get(car.id) ?? []
          const last = todays[todays.length - 1] ?? old[old.length - 1]
          return last ? [last] : []
        }),
      positionAt: (carId, at) => positionAt(plan, carId, at),
    }
  }

  return {
    cars: CARS,
    geofences,
    view() {
      const t = now()
      const dayStart = localDayStart(t, tz)
      if (!built || built.dayStart !== dayStart) {
        built = {
          dayStart,
          history: buildHistory(dayStart, tz, CARS.map((c) => c.id)),
          plan: buildTodayPlan(dayStart, t),
        }
        cached = null
      }
      const key = Math.floor(t / VIEW_STEP_MS)
      if (!cached || cached.key !== key) {
        const step = key * VIEW_STEP_MS
        cached = { key, view: makeView(built.history, built.plan, materialize(built.plan, step)) }
      }
      return cached.view
    },
  }
}
