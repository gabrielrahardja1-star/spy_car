import { describe, expect, it } from 'vitest'
import { formatDms, parseCoordinates } from './coords'

const AREA2 = { lat: -3.172511, lon: 115.281808 }
const close = (p: { lat: number; lon: number } | null) => p && { lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) }

describe('parseCoordinates', () => {
  it('reads degrees-minutes-seconds in either order, with or without labels', () => {
    expect(close(parseCoordinates(`3°10'21.04"S 115°16'54.51"E`))).toEqual(AREA2)
    expect(close(parseCoordinates(`long : 115°16'54.51"E\nLat :   3°10'21.04"S`))).toEqual(AREA2)
    expect(close(parseCoordinates(`3° 10′ 21.04″ S, 115° 16′ 54.51″ E`))).toEqual(AREA2)
  })

  it('reads decimal degrees, latitude first', () => {
    expect(parseCoordinates('-3.172511, 115.281808')).toEqual(AREA2)
    expect(parseCoordinates('-3.172511 115.281808')).toEqual(AREA2)
  })

  it('accepts whole degrees and minutes without seconds', () => {
    expect(parseCoordinates(`3°S 115°E`)).toEqual({ lat: -3, lon: 115 })
    expect(close(parseCoordinates(`3°30'N 115°15'W`))).toEqual({ lat: 3.5, lon: -115.25 })
  })

  it('refuses what is not one clear point', () => {
    for (const bad of ['', 'Area 2', '-3.17', '1, 2, 3', `3°10'21"S`, `3°10'21"S 4°10'21"S`, '95, 10', `3°75'S 115°E`]) {
      expect(parseCoordinates(bad)).toBeNull()
    }
  })
})

describe('formatDms', () => {
  it('writes the familiar form and reads back the same point', () => {
    expect(formatDms(AREA2)).toBe(`3°10'21.04"S 115°16'54.51"E`)
    expect(close(parseCoordinates(formatDms(AREA2)))).toEqual(AREA2)
  })
})
