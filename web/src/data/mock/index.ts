// OWNED BY: mock agent. Deterministic mock DataSource (PLAN.md Phase 2).
import { config } from '../../config'
import type { DataSource } from '../source'
import type { Stop, Summary, Trip } from '../types'
import { startFeed } from './live'
import { createWorld } from './world'

export interface MockOptions {
  /** Injectable clock so tests are deterministic. Defaults to Date.now. */
  now?: () => number
  /** ms between live position messages for the moving car. Default 2000. */
  tickMs?: number
}

/** A trip overlaps [from, to) if it starts before `to` and has not ended before `from`. An open trip never ends. */
function overlaps(trip: Trip, from: number, to: number): boolean {
  return trip.startTime < to && (trip.endTime === null || trip.endTime > from)
}

export function createMockDataSource(opts: MockOptions = {}): DataSource {
  const now = opts.now ?? Date.now
  const tickMs = opts.tickMs ?? 2000
  const world = createWorld(now, config.timezone)

  const tripsIn = (carId: string | null, from: number, to: number): Trip[] =>
    world.view().trips.filter((t) => (carId === null || t.carId === carId) && overlaps(t, from, to))

  return {
    getCars: async () => world.cars.slice(),
    getGeofences: async () => world.geofences.slice(),
    getLatestPositions: async () => world.view().latest(),

    subscribe(handlers) {
      const view = () => world.view()
      return startFeed(
        {
          now,
          carIds: world.cars.map((c) => c.id),
          get gaps() {
            return view().gaps
          },
          positionAt: (carId, t) => view().positionAt(carId, t),
          fixesBetween: (carId, from, to) => view().route(carId, from, to + 1),
        },
        handlers,
        tickMs,
      )
    },

    getRoute: async (carId, from, to) => world.view().route(carId, from, to),

    getTrips: async (carId, from, to) => tripsIn(carId, from, to),

    getStops: async (carId, from, to) => {
      const stops: Stop[] = tripsIn(carId, from, to).flatMap((t) => t.stops)
      return stops.filter((s) => s.startTime < to && s.endTime > from).sort((a, b) => b.startTime - a.startTime)
    },

    getSummary: async (from, to) =>
      world.cars.map((car): Summary => {
        const trips = tripsIn(car.id, from, to)
        return {
          carId: car.id,
          distanceM: trips.reduce((sum, t) => sum + t.distanceM, 0),
          drivingMs: trips.reduce((sum, t) => sum + t.drivingMs, 0),
          tripCount: trips.length,
          stopCount: trips.reduce((sum, t) => sum + t.stops.length, 0),
          inProgressCount: trips.filter((t) => t.endTime === null).length,
        }
      }),
  }
}
