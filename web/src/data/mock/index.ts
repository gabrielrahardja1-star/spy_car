// OWNED BY: mock agent. Deterministic mock DataSource (PLAN.md Phase 2).
import { config } from '../../config'
import { EditRefused, truckInputProblem, type DataSource, type TruckRecord } from '../source'
import type { Car, Stop, Summary, Trip } from '../types'
import { startFeed } from './live'
import { locationGeofence } from './places'
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

  // Truck edits live in memory until the page reloads. A new truck has no data; a disabled one is hidden everywhere.
  // DT-01 plays a real truck with a GPS tracker, DT-02 a test truck driven by the simulator.
  let fleet: TruckRecord[] = world.cars.map((c, i) =>
    i === 0
      ? { ...c, source: 'tracker', trackerId: '490154203237518', model: 'teltonika', phone: '+62 812 0000 0001', enabled: true }
      : { ...c, source: 'simulator', trackerId: `sim-dt-0${i + 1}`, model: '', phone: '', enabled: true },
  )
  let nextTruck = 1
  const carListeners = new Set<() => void>()
  const carsChanged = () => {
    for (const l of carListeners) l()
  }
  const activeCars = (): Car[] =>
    fleet.filter((t) => t.enabled).map(({ id, name, driver, source }) => ({ id, name, driver, ...(source === 'tracker' ? {} : { test: true }) }))
  const isActive = (carId: string) => fleet.some((t) => t.id === carId && t.enabled)
  const truckAt = (id: string) => {
    const truck = fleet.find((t) => t.id === id)
    if (!truck) throw new EditRefused('That truck no longer exists. Reload the page.')
    return truck
  }

  const tripsIn = (carId: string | null, from: number, to: number): Trip[] =>
    world.view().trips.filter((t) => (carId === null ? isActive(t.carId) : t.carId === carId) && overlaps(t, from, to))

  // Location edits live in memory until the page reloads. Finished trips keep the places they were built with.
  const geofenceListeners = new Set<() => void>()
  let nextLocation = 1
  const geofencesChanged = () => {
    for (const l of geofenceListeners) l()
  }

  return {
    getCars: async () => activeCars(),
    trucks: {
      canEdit: async () => true,
      list: async () => fleet.map((t) => ({ ...t })).sort((a, b) => a.name.localeCompare(b.name)),
      async save(input, id) {
        const problem = truckInputProblem(input, fleet.filter((t) => t.id !== id))
        if (problem) throw new EditRefused(problem)
        const real = input.source === 'tracker'
        const fields = {
          name: input.name.trim(),
          source: input.source,
          trackerId: input.trackerId.trim(),
          model: real ? input.model : '',
          phone: real ? input.phone.trim() : '',
          driver: input.driver.trim(),
        }
        if (id === undefined) fleet = [...fleet, { id: `new-${nextTruck++}`, ...fields, enabled: true }]
        else fleet = fleet.map((t) => (t.id === truckAt(id).id ? { ...t, ...fields } : t))
        carsChanged()
      },
      async setEnabled(id, enabled) {
        truckAt(id)
        fleet = fleet.map((t) => (t.id === id ? { ...t, enabled } : t))
        carsChanged()
      },
      async remove(id) {
        fleet = fleet.filter((t) => t.id !== id)
        carsChanged()
      },
    },
    onCarsChange(listener) {
      carListeners.add(listener)
      return () => carListeners.delete(listener)
    },
    getGeofences: async () => world.geofences.slice(),
    locations: {
      canEdit: async () => true,
      async save(input, id) {
        const fence = locationGeofence(id ?? `g-new-${nextLocation++}`, { ...input, name: input.name.trim() })
        const i = world.geofences.findIndex((g) => g.id === id)
        if (id !== undefined && i < 0) throw new EditRefused('That location no longer exists. Reload the page.')
        if (i >= 0) world.geofences[i] = fence
        else world.geofences.push(fence)
        geofencesChanged()
      },
      async remove(id) {
        const i = world.geofences.findIndex((g) => g.id === id)
        if (i >= 0) world.geofences.splice(i, 1)
        geofencesChanged()
      },
    },
    onGeofencesChange(listener) {
      geofenceListeners.add(listener)
      return () => geofenceListeners.delete(listener)
    },
    getLatestPositions: async () => world.view().latest().filter((p) => isActive(p.carId)),

    subscribe(handlers) {
      const view = () => world.view()
      return startFeed(
        {
          now,
          carIds: activeCars().map((c) => c.id),
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
      activeCars().map((car): Summary => {
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
