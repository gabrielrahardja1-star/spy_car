// Domain types shared by every data source and every screen.
// Units are fixed at the data-module boundary: metres, milliseconds, km/h, ms since epoch (UTC).
// A Traccar implementation converts knots to km/h itself (PLAN.md 5.2).

export type CarStatus = 'moving' | 'parked' | 'nosignal'

export interface Car {
  id: string
  /** On-screen name, e.g. "Car 01". */
  name: string
  /** Driver label, e.g. "[Driver name]" in the mock. Empty string = unknown; the UI then shows no driver line. */
  driver: string
}

export interface Position {
  carId: string
  /** Time the tracker took the fix. Always sort by this, never by arrival order. */
  fixTime: number
  lat: number
  lon: number
  speedKmh: number
  /** Heading in degrees, 0 = north. */
  course: number
  /** Traccar's `motion` attribute. */
  motion: boolean
}

export interface Geofence {
  id: string
  name: string
  /** "site" is the work-site zone drawn on the map; "place" is any other named place. */
  kind: 'site' | 'place'
  /** Closed ring of [lon, lat] points. */
  polygon: [number, number][]
}

export interface Stop {
  carId: string
  startTime: number
  endTime: number
  durationMs: number
  lat: number
  lon: number
  /** Geofence name, or null if outside every geofence. */
  place: string | null
}

export interface Trip {
  id: string
  carId: string
  startTime: number
  /** null while the trip is in progress. */
  endTime: number | null
  startPlace: string | null
  endPlace: string | null
  distanceM: number
  /** Time spent driving (excludes stops). */
  drivingMs: number
  maxSpeedKmh: number
  /** Stops that happened during this trip. */
  stops: Stop[]
  /** false = `stops` could not be worked out for this trip (so [] means "unknown", not "none"). Absent = known. */
  stopsKnown?: false
  /** Reverse-geocoded addresses from the tracker server, when it has them. Secondary text when no geofence matched. */
  startAddress?: string
  endAddress?: string
}

export interface SignalGap {
  carId: string
  startTime: number
  endTime: number
  durationMs: number
}

export interface Summary {
  carId: string
  distanceM: number
  drivingMs: number
  tripCount: number
  stopCount: number
  /** Count of trips with endTime === null. */
  inProgressCount: number
}

/** One car as the Live map needs it: latest fix plus values derived from it at `now`. */
export interface LiveCar {
  car: Car
  /** Latest fix by fixTime, or null if the car has never reported. */
  position: Position | null
  status: CarStatus
  /** Age of the last fix at `now`. null if no fix. */
  lastSeenMs: number | null
  /** Time since the car last moved. null unless status is "parked". */
  parkedForMs: number | null
}

export interface StripSegment {
  kind: CarStatus
  startTime: number
  endTime: number
  /** Share of the workday strip, 0..100. */
  widthPct: number
  /** Tooltip, e.g. "Moving 07:42 to 07:58" or "Parked 3 min". */
  title: string
}
