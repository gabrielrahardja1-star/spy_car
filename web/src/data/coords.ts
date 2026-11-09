// Coordinates as people type or paste them: degrees-minutes-seconds with N/S/E/W in either order, with or without
// "Lat :" / "Long :" labels (3°10'21.04"S 115°16'54.51"E), or decimal degrees, latitude first (-3.172511, 115.281808).

export interface LatLon {
  lat: number
  lon: number
}

const DMS = /(\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|”|''|′′)\s*)?([NSEW])/gi

function valid(lat: number, lon: number): LatLon | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

/** The point in `text`, or null when it does not hold exactly one latitude and one longitude. */
export function parseCoordinates(text: string): LatLon | null {
  const dms = [...text.matchAll(DMS)]
  if (dms.length > 0) {
    if (dms.length !== 2) return null
    let lat: number | null = null
    let lon: number | null = null
    for (const [, d, m, s, hemi] of dms) {
      const minutes = Number(m ?? 0)
      const seconds = Number(s ?? 0)
      if (minutes >= 60 || seconds >= 60) return null
      const value = Number(d) + minutes / 60 + seconds / 3600
      const h = hemi.toUpperCase()
      if (h === 'N' || h === 'S') lat = h === 'S' ? -value : value
      else lon = h === 'W' ? -value : value
    }
    return lat === null || lon === null ? null : valid(lat, lon)
  }
  const numbers = text.match(/[-+]?\d+(?:\.\d+)?/g)
  if (!numbers || numbers.length !== 2) return null
  return valid(Number(numbers[0]), Number(numbers[1]))
}

/** 3°10'21.04"S 115°16'54.51"E */
export function formatDms({ lat, lon }: LatLon): string {
  const part = (v: number, pos: string, neg: string) => {
    let total = Math.round(Math.abs(v) * 360000) // hundredths of a second
    const d = Math.floor(total / 360000)
    total -= d * 360000
    const m = Math.floor(total / 6000)
    const s = (total - m * 6000) / 100
    return `${d}°${m}'${s.toFixed(2)}"${v < 0 ? neg : pos}`
  }
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`
}
