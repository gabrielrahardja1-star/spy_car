// Parses Traccar geofence `area` strings. Traccar writes LATITUDE FIRST (GeofencePolygon.toWkt / GeofenceCircle.toWkt):
//   POLYGON ((lat lon, lat lon, ...))      CIRCLE (lat lon, radiusMetres)
// Our rings are [lon, lat], so the pairs are swapped here. LINESTRING and anything malformed give null.

const CIRCLE_POINTS = 32
const M_PER_DEG_LAT = 110574

function pair(token: string): [number, number] | null {
  const parts = token.trim().split(/\s+/)
  if (parts.length !== 2) return null
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null
  return [a, b]
}

function closed(ring: [number, number][]): [number, number][] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [first[0], first[1]]]
}

/** A circle as a closed ring of 32 points (plus the repeated first point). Radius in metres. */
export function circleToRing(lat: number, lon: number, radiusM: number): [number, number][] {
  const mPerLon = 111320 * Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i < CIRCLE_POINTS; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_POINTS
    ring.push([lon + (radiusM * Math.sin(a)) / mPerLon, lat + (radiusM * Math.cos(a)) / M_PER_DEG_LAT])
  }
  return closed(ring)
}

/** Closed ring of [lon, lat], or null when the area is not a usable POLYGON or CIRCLE. */
export function parseArea(area: unknown): [number, number][] | null {
  if (typeof area !== 'string') return null
  const text = area.trim()

  const poly = /^POLYGON\s*\(\(([^()]*)\)\)$/i.exec(text)
  if (poly) {
    const pairs = poly[1].split(',').map(pair)
    if (pairs.length < 3 || pairs.some((p) => p === null)) return null
    return closed((pairs as [number, number][]).map(([lat, lon]): [number, number] => [lon, lat]))
  }

  const circle = /^CIRCLE\s*\(([^(),]+),([^(),]+)\)$/i.exec(text)
  if (circle) {
    const centre = pair(circle[1])
    const radius = Number(circle[2])
    if (!centre || !Number.isFinite(radius) || radius <= 0) return null
    return circleToRing(centre[0], centre[1], radius)
  }

  return null
}

/** Inverse of parseArea for polygons, used by the fake server and tests: [lon, lat] ring -> Traccar WKT. */
export function ringToPolygonWkt(ring: [number, number][]): string {
  return `POLYGON ((${ring.map(([lon, lat]) => `${lat} ${lon}`).join(', ')}))`
}
