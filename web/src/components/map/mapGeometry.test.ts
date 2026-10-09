import { describe, expect, it } from 'vitest'
import type { Geofence, Position } from '../../data/types'
import { GLIDE_MAX_M, boundsOf, centroid, distanceM, glideAngle, glideAt, siteFeatures, southEdge, trailCoordinates, trailFeature, type LngLat } from './mapGeometry'

const fix = (fixTime: number, lon: number, lat: number): Position => ({ carId: 'c', fixTime, lat, lon, speedKmh: 0, course: 0, motion: false })

describe('centroid / southEdge / boundsOf', () => {
  const ring: LngLat[] = [[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]
  it('ignores the repeated closing point', () => {
    expect(centroid(ring)).toEqual([2, 1])
  })
  it('puts the label point on the southern edge', () => {
    expect(southEdge(ring)).toEqual([2, 0])
  })
  it('boxes points, and returns null for none', () => {
    expect(boundsOf([[3, 1], [1, 5], [2, 2]])).toEqual([[1, 1], [3, 5]])
    expect(boundsOf([])).toBeNull()
  })
})

describe('glideAt', () => {
  it('interpolates and clamps t', () => {
    expect(glideAt([0, 0], [10, 20], 0.5)).toEqual([5, 10])
    expect(glideAt([0, 0], [10, 20], -1)).toEqual([0, 0])
    expect(glideAt([0, 0], [10, 20], 2)).toEqual([10, 20])
  })
})

describe('distanceM', () => {
  it('is about 111 km per degree of latitude', () => {
    expect(distanceM([119, -5], [119, -4])).toBeGreaterThan(110_000)
    expect(distanceM([119, -5], [119, -4])).toBeLessThan(112_000)
  })
  it('a ping a few metres away glides, one across town jumps', () => {
    expect(distanceM([119.41, -5.14], [119.4101, -5.14])).toBeLessThan(GLIDE_MAX_M)
    expect(distanceM([119.41, -5.14], [119.5, -5.14])).toBeGreaterThan(GLIDE_MAX_M)
  })
})

describe('trailCoordinates', () => {
  it('sorts by fix time, not arrival order (buffered pings arrive late)', () => {
    const coords = trailCoordinates([fix(30, 3, 3), fix(10, 1, 1), fix(20, 2, 2)], null)
    expect(coords).toEqual([[1, 1], [2, 2], [3, 3]])
  })
  it('appends a live fix only if it is newer than the route', () => {
    expect(trailCoordinates([fix(10, 1, 1)], fix(20, 2, 2))).toEqual([[1, 1], [2, 2]])
    expect(trailCoordinates([fix(10, 1, 1)], fix(5, 9, 9))).toEqual([[1, 1]])
    expect(trailCoordinates([], fix(5, 9, 9))).toEqual([[9, 9]])
  })
  it('a single point is no line', () => {
    expect(trailFeature([[1, 1]]).features).toHaveLength(0)
    expect(trailFeature([[1, 1], [2, 2]]).features).toHaveLength(1)
  })
})

describe('siteFeatures', () => {
  const g = (kind: Geofence['kind']): Geofence => ({ id: kind, name: kind, kind, polygon: [[0, 0], [1, 0], [1, 1], [0, 0]] })
  it('only the site zone is drawn as a polygon', () => {
    const fc = siteFeatures([g('place'), g('site')])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toEqual({ name: 'site' })
  })
})

describe('glideAngle', () => {
  it('turns the short way round', () => {
    expect(glideAngle(350, 10, 0.5)).toBeCloseTo(0)
    expect(glideAngle(10, 350, 0.5)).toBeCloseTo(0)
    expect(glideAngle(0, 90, 0.5)).toBeCloseTo(45)
  })
  it('returns the ends at t 0 and 1, normalised to 0..360', () => {
    expect(glideAngle(30, 200, 0)).toBeCloseTo(30)
    expect(glideAngle(30, 200, 1)).toBeCloseTo(200)
    expect(glideAngle(359, 1, 1)).toBeCloseTo(1)
  })
})
