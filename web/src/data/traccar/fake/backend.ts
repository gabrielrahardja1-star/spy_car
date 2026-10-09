// A stand-in for Traccar's data side, built from any DataSource (the mock, in practice): the same facts in Traccar's
// JSON shapes and units (knots, ISO strings, WKT latitude first, trips split at parking). Used by the local fake server
// (web/dev/fake-traccar.mjs) and by the round-trip tests, so both exercise the real conversion code in ../convert.ts.
// Not imported by the app, so it never reaches the production bundle.
import type { DataSource } from '../../source'
import type { Car, Geofence, Position, Trip } from '../../types'
import type { TraccarDevice, TraccarGeofence, TraccarPosition, TraccarStop, TraccarTrip } from '../api'
import { pathLengthM } from '../geo'
import { ringToPolygonWkt } from '../wkt'

const KMH_PER_KNOT = 1.852

export interface FakeBackendOptions {
  now?: () => number
  /**
   * Like Traccar's report.trip.minimalParkingDuration: a stop this long ends the trip and starts a new one.
   * Infinity (default) maps every source trip to exactly one Traccar trip.
   */
  minParkingMs?: number
  /** Leave the unfinished trip out of /reports/trips, as a Traccar that has not caught up yet would. */
  omitOpenTrip?: boolean
}

export interface FakeBackend {
  devices(): TraccarDevice[]
  geofences(): TraccarGeofence[]
  latestPositions(): Promise<TraccarPosition[]>
  route(deviceIds: number[], from: number, to: number): Promise<TraccarPosition[]>
  trips(deviceIds: number[], from: number, to: number): Promise<TraccarTrip[]>
  stops(deviceIds: number[], from: number, to: number): Promise<TraccarStop[]>
  toTraccarPositions(positions: Position[]): TraccarPosition[]
}

export function toTraccarPosition(p: Position, deviceId: number): TraccarPosition {
  return {
    deviceId,
    fixTime: new Date(p.fixTime).toISOString(),
    valid: true,
    latitude: p.lat,
    longitude: p.lon,
    speed: p.speedKmh / KMH_PER_KNOT,
    course: p.course,
    attributes: { motion: p.motion },
  }
}

function geofenceArea(g: Geofence): string {
  return ringToPolygonWkt(g.polygon)
}

export async function createFakeBackend(source: DataSource, opts: FakeBackendOptions = {}): Promise<FakeBackend> {
  const now = opts.now ?? Date.now
  const minParkingMs = opts.minParkingMs ?? Infinity
  const cars: Car[] = await source.getCars()
  const geofences = await source.getGeofences()
  const idOf = new Map(cars.map((c, i) => [c.id, i + 1]))
  const carOf = new Map(cars.map((c, i) => [i + 1, c.id]))

  const devices: TraccarDevice[] = cars.map((c, i) => ({
    id: i + 1,
    name: c.name,
    uniqueId: `fake-${i + 1}`,
    status: 'online',
    attributes: c.driver ? { driver: c.driver } : {},
  }))

  const convert = (ps: Position[]) => ps.flatMap((p) => (idOf.has(p.carId) ? [toTraccarPosition(p, idOf.get(p.carId) as number)] : []))
  const carIds = (deviceIds: number[]) => deviceIds.flatMap((d) => carOf.get(d) ?? [])

  const iso = (t: number) => new Date(t).toISOString()

  /** One Traccar trip for [start, end] of a source trip, measured from the fixes inside it. */
  async function tripPiece(carId: string, start: number, end: number): Promise<TraccarTrip | null> {
    const fixes = await source.getRoute(carId, start, end + 1)
    if (fixes.length === 0) return null
    const first = fixes[0]
    const last = fixes[fixes.length - 1]
    return {
      deviceId: idOf.get(carId) as number,
      startTime: iso(first.fixTime),
      endTime: iso(last.fixTime),
      distance: pathLengthM(fixes),
      maxSpeed: Math.max(...fixes.map((f) => f.speedKmh)) / KMH_PER_KNOT,
      startLat: first.lat,
      startLon: first.lon,
      endLat: last.lat,
      endLon: last.lon,
      startAddress: null,
      endAddress: null,
    }
  }

  /** Parking periods and trips for the cars, clipped to [from, to] like the real reports (they only see that window). */
  async function segments(ids: string[], from: number, to: number) {
    const out: { carId: string; kind: 'trip' | 'stop'; start: number; end: number; open?: boolean }[] = []
    const at = now()
    for (const carId of ids) {
      const trips = (await source.getTrips(carId, from, to)).slice().sort((a, b) => a.startTime - b.startTime)
      const latest = (await source.getLatestPositions()).find((p) => p.carId === carId)
      const lastFix = Math.min(to, latest ? Math.min(latest.fixTime, at) : at)
      let cursor = from
      for (const t of trips) {
        const tripEnd = t.endTime ?? lastFix
        const pieces = splitAtParking(t, tripEnd, minParkingMs)
        for (const [index, piece] of pieces.entries()) {
          if (piece.kind === 'stop') {
            const s = Math.max(piece.start, from)
            const e = Math.min(piece.end, to)
            if (e > s) out.push({ carId, kind: 'stop', start: s, end: e })
            cursor = Math.max(cursor, piece.end)
            continue
          }
          const s = Math.max(piece.start, from)
          const e = Math.min(piece.end, to)
          if (e <= s) continue
          if (s > cursor) out.push({ carId, kind: 'stop', start: cursor, end: s })
          out.push({ carId, kind: 'trip', start: s, end: e, open: t.endTime === null && index === pieces.length - 1 })
          cursor = Math.max(cursor, e)
        }
      }
      if (cursor < lastFix && !(trips.length > 0 && trips[trips.length - 1].endTime === null)) {
        out.push({ carId, kind: 'stop', start: cursor, end: lastFix })
      }
    }
    return out
  }

  return {
    devices: () => devices,
    geofences: () => geofences.map((g, i): TraccarGeofence => ({ id: i + 1, name: g.name, area: geofenceArea(g) })),
    latestPositions: async () => convert(await source.getLatestPositions()),
    route: async (deviceIds, from, to) => {
      const lists = await Promise.all(carIds(deviceIds).map((id) => source.getRoute(id, from, to + 1)))
      return convert(lists.flat())
    },
    trips: async (deviceIds, from, to) => {
      const segs = (await segments(carIds(deviceIds), from, to)).filter((s) => s.kind === 'trip')
      const result: TraccarTrip[] = []
      for (const s of segs) {
        if (s.open && opts.omitOpenTrip) continue
        const piece = await tripPiece(s.carId, s.start, s.end)
        if (piece) result.push(piece)
      }
      return result
    },
    stops: async (deviceIds, from, to) => {
      const segs = (await segments(carIds(deviceIds), from, to)).filter((s) => s.kind === 'stop')
      const result: TraccarStop[] = []
      for (const s of segs) {
        const fixes = await source.getRoute(s.carId, s.start, s.end + 1)
        const at = fixes[0]
        if (!at) continue
        result.push({
          deviceId: idOf.get(s.carId) as number,
          startTime: iso(s.start),
          endTime: iso(s.end),
          latitude: at.lat,
          longitude: at.lon,
          address: null,
        })
      }
      return result
    },
    toTraccarPositions: convert,
  }
}

/** A trip as alternating drive/parking pieces: stops of at least minParkingMs split it. */
function splitAtParking(trip: Trip, end: number, minParkingMs: number) {
  const parking = trip.stops.filter((s) => s.durationMs >= minParkingMs).sort((a, b) => a.startTime - b.startTime)
  const pieces: { kind: 'trip' | 'stop'; start: number; end: number }[] = []
  let cursor = trip.startTime
  for (const s of parking) {
    pieces.push({ kind: 'trip', start: cursor, end: s.startTime })
    pieces.push({ kind: 'stop', start: s.startTime, end: s.endTime })
    cursor = s.endTime
  }
  pieces.push({ kind: 'trip', start: cursor, end })
  return pieces
}
