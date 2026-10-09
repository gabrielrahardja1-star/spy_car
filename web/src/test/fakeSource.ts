import type { DataSource } from '../data/source'
import type { Car, Geofence, Position, Stop, Summary, Trip } from '../data/types'

export interface FakeData {
  cars?: Car[]
  geofences?: Geofence[]
  positions?: Position[]
  trips?: Trip[]
}

export const CAR_1: Car = { id: 'car-1', name: 'Car 01', driver: '[Driver name]' }
export const CAR_2: Car = { id: 'car-2', name: 'Car 02', driver: '[Driver name]' }

/** Small in-memory DataSource for tests that need full control of what the screens see. */
export function createFakeSource(data: FakeData = {}): DataSource & {
  /** Push a live message to the subscriber. */
  push(positions: Position[], receivedAt?: number): void
} {
  const cars = data.cars ?? [CAR_1, CAR_2]
  const positions = data.positions ?? []
  const trips = data.trips ?? []
  let handlers: Parameters<DataSource['subscribe']>[0] | null = null

  const overlapping = (carId: string | null, from: number, to: number) =>
    trips
      .filter((t) => (carId === null || t.carId === carId) && t.startTime < to && (t.endTime ?? Infinity) > from)
      .sort((a, b) => b.startTime - a.startTime)

  return {
    getCars: async () => cars,
    getGeofences: async () => data.geofences ?? [],
    getLatestPositions: async () =>
      cars.flatMap((c) => {
        const mine = positions.filter((p) => p.carId === c.id).sort((a, b) => b.fixTime - a.fixTime)
        return mine[0] ? [mine[0]] : []
      }),
    subscribe(h) {
      handlers = h
      return () => {
        handlers = null
      }
    },
    getRoute: async (carId, from, to) =>
      positions.filter((p) => p.carId === carId && p.fixTime >= from && p.fixTime < to).sort((a, b) => a.fixTime - b.fixTime),
    getTrips: async (carId, from, to) => overlapping(carId, from, to),
    getStops: async (carId, from, to): Promise<Stop[]> => overlapping(carId, from, to).flatMap((t) => t.stops),
    getSummary: async (from, to): Promise<Summary[]> =>
      cars.map((c) => {
        const mine = overlapping(c.id, from, to)
        return {
          carId: c.id,
          distanceM: mine.reduce((s, t) => s + t.distanceM, 0),
          drivingMs: mine.reduce((s, t) => s + t.drivingMs, 0),
          tripCount: mine.length,
          stopCount: mine.reduce((s, t) => s + t.stops.length, 0),
          inProgressCount: mine.filter((t) => t.endTime === null).length,
        }
      }),
    push(p, receivedAt = Date.now()) {
      handlers?.onPositions(p)
      handlers?.onMessage?.(receivedAt)
    },
  }
}

export function position(carId: string, fixTime: number, over: Partial<Position> = {}): Position {
  return { carId, fixTime, lat: 0, lon: 0, speedKmh: 0, course: 0, motion: false, ...over }
}

export function trip(carId: string, startTime: number, endTime: number | null, over: Partial<Trip> = {}): Trip {
  return {
    id: `${carId}-${startTime}`,
    carId,
    startTime,
    endTime,
    startPlace: 'Origin',
    endPlace: 'Destination',
    distanceM: 10_000,
    drivingMs: 20 * 60_000,
    maxSpeedKmh: 60,
    stops: [],
    ...over,
  }
}
