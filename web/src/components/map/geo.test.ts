import { describe, expect, it } from 'vitest'
import type { Geofence } from '../../data/types'
import { geofenceAt, pointInPolygon } from './geo'

const square: [number, number][] = [
  [10, 0],
  [10, 10],
  [20, 10],
  [20, 0],
  [10, 0],
]
const lShape: [number, number][] = [
  [0, 0],
  [0, 10],
  [5, 10],
  [5, 5],
  [10, 5],
  [10, 0],
]

describe('pointInPolygon', () => {
  it('is true inside and false outside a square', () => {
    expect(pointInPolygon(15, 5, square)).toBe(true)
    expect(pointInPolygon(25, 5, square)).toBe(false)
    expect(pointInPolygon(15, -1, square)).toBe(false)
  })

  it('handles a concave ring', () => {
    expect(pointInPolygon(2, 8, lShape)).toBe(true)
    expect(pointInPolygon(8, 2, lShape)).toBe(true)
    expect(pointInPolygon(8, 8, lShape)).toBe(false)
  })
})

describe('geofenceAt', () => {
  const place: Geofence = { id: 'p', name: 'Place', kind: 'place', polygon: square }
  const site: Geofence = { id: 's', name: 'Zone', kind: 'site', polygon: square }

  it('returns null outside every geofence', () => {
    expect(geofenceAt(0, 0, [place, site])).toBeNull()
  })

  it('prefers the site zone when geofences overlap', () => {
    expect(geofenceAt(15, 5, [place, site])?.id).toBe('s')
    expect(geofenceAt(15, 5, [place])?.id).toBe('p')
  })
})
