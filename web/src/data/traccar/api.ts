// Traccar REST/WebSocket JSON shapes, as far as this app reads them.
//
// Followed: Traccar 6.x. OpenAPI spec (openapi.yaml, info.version 6.16.0) checked against the server source
// (SessionResource, AsyncSocket, AsyncSocketServlet, ReportUtils, Geofence*.java, *ReportItem.java on master).
// Where the spec and the source disagree, the source wins and both spellings are read:
//   - report `duration` is documented as seconds but the server fills it in milliseconds -> never used; times are subtracted.
//   - stop items are documented with `lat`/`lon` but the server class has `latitude`/`longitude` -> both read.
// Units on the wire: speed/maxSpeed in KNOTS, distance in metres, times ISO 8601 UTC, course in degrees.

export interface TraccarDevice {
  id: number
  name: string
  uniqueId?: string
  status?: string
  disabled?: boolean
  lastUpdate?: string | null
  positionId?: number | null
  attributes?: Record<string, unknown>
}

export interface TraccarPosition {
  id?: number
  deviceId: number
  /** ISO 8601 UTC. The time the tracker took the fix; `serverTime` is arrival and is not used. */
  fixTime: string
  valid?: boolean
  latitude: number
  longitude: number
  /** Knots. */
  speed?: number
  course?: number
  address?: string | null
  attributes?: { motion?: boolean } & Record<string, unknown>
}

export interface TraccarGeofence {
  id: number
  name: string
  /** WKT with latitude first: "POLYGON ((lat lon, ...))" or "CIRCLE (lat lon, radiusMetres)". */
  area: string
}

export interface TraccarTrip {
  deviceId: number
  startTime: string
  endTime: string
  /** Metres. */
  distance?: number
  /** Knots. */
  maxSpeed?: number
  startLat?: number
  startLon?: number
  endLat?: number
  endLon?: number
  startAddress?: string | null
  endAddress?: string | null
  driverName?: string | null
}

export interface TraccarStop {
  deviceId: number
  startTime: string
  endTime: string
  latitude?: number
  longitude?: number
  lat?: number
  lon?: number
  address?: string | null
}

/** One WebSocket message: every key is optional, most messages carry only one. `{}` is the server keep-alive. */
export interface TraccarSocketMessage {
  positions?: TraccarPosition[]
  devices?: TraccarDevice[]
  events?: unknown[]
}
