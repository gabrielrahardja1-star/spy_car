// Traccar JSON -> domain types. Pure. All unit conversion happens here (knots -> km/h, ISO -> ms; metres stay metres).
import { config, type Config } from '../../config'
import { knotsToKmh } from '../derive'
import type { Car, Geofence, Position, Trip } from '../types'
import type { TraccarDevice, TraccarGeofence, TraccarPosition, TraccarTrip } from './api'
import { geofenceNameAt } from './geo'
import { parseArea } from './wkt'

export const carIdOf = (deviceId: number): string => String(deviceId)

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
}

/** Devices the owner switched off are not cars. The on-screen name is the device name; the driver label is optional. */
export function toCar(d: TraccarDevice): Car {
  const attrs = d.attributes ?? {}
  return { id: carIdOf(d.id), name: d.name, driver: nonEmpty(attrs.driver) ?? nonEmpty(attrs.driverName) ?? '' }
}

/**
 * A fix with an unparseable time or coordinates is dropped, and so is a fix at exactly 0,0 (a tracker without a GPS lock
 * reports that). `motion` comes from Traccar's attribute, else from the speed threshold.
 */
export function toPosition(p: TraccarPosition, cfg: Config = config): Position | null {
  const fixTime = Date.parse(p.fixTime)
  if (!Number.isFinite(fixTime) || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null
  if (p.latitude === 0 && p.longitude === 0) return null
  const speedKmh = knotsToKmh(Number.isFinite(p.speed) ? (p.speed as number) : 0)
  const motion = typeof p.attributes?.motion === 'boolean' ? p.attributes.motion : speedKmh > cfg.movingKmh
  return {
    carId: carIdOf(p.deviceId),
    fixTime,
    lat: p.latitude,
    lon: p.longitude,
    speedKmh,
    course: Number.isFinite(p.course) ? (p.course as number) : 0,
    motion,
  }
}

/** Geofences with a usable shape. The one named like cfg.siteGeofenceName (case-insensitive) is the site zone. */
export function toGeofences(list: TraccarGeofence[], cfg: Config = config): Geofence[] {
  const siteName = cfg.siteGeofenceName.trim().toLowerCase()
  const out: Geofence[] = []
  for (const g of list) {
    const polygon = parseArea(g.area)
    if (!polygon) continue
    out.push({
      id: String(g.id),
      name: g.name,
      kind: g.name.trim().toLowerCase() === siteName ? 'site' : 'place',
      polygon,
    })
  }
  return out
}

/**
 * One finished Traccar trip (a drive between two parked periods). Stops are filled in later, from the route.
 * drivingMs starts as the whole duration; the report's own `duration` field is ignored (see api.ts).
 * Places: the geofence containing the start/end point, else null. A server address is kept as secondary text.
 */
export function toTrip(t: TraccarTrip, geofences: Geofence[]): Trip | null {
  const startTime = Date.parse(t.startTime)
  const endTime = Date.parse(t.endTime)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return null
  const place = (lat: number | undefined, lon: number | undefined) =>
    Number.isFinite(lat) && Number.isFinite(lon) ? geofenceNameAt(lat as number, lon as number, geofences) : null
  const carId = carIdOf(t.deviceId)
  const trip: Trip = {
    id: `${carId}-${startTime}`,
    carId,
    startTime,
    endTime,
    startPlace: place(t.startLat, t.startLon),
    endPlace: place(t.endLat, t.endLon),
    distanceM: Math.round(t.distance ?? 0),
    drivingMs: endTime - startTime,
    maxSpeedKmh: knotsToKmh(t.maxSpeed ?? 0),
    stops: [],
  }
  const startAddress = nonEmpty(t.startAddress)
  const endAddress = nonEmpty(t.endAddress)
  if (startAddress) trip.startAddress = startAddress
  if (endAddress) trip.endAddress = endAddress
  return trip
}
