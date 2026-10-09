import { describe, expect, it } from 'vitest'
import { haversineM } from './geo'
import { circleToRing, parseArea, ringToPolygonWkt } from './wkt'

describe('parseArea', () => {
  it('reads a polygon and swaps Traccar latitude-first pairs into [lon, lat]', () => {
    const ring = parseArea('POLYGON ((-5.1 119.4, -5.2 119.4, -5.2 119.5, -5.1 119.5))')
    expect(ring).toEqual([
      [119.4, -5.1],
      [119.4, -5.2],
      [119.5, -5.2],
      [119.5, -5.1],
      [119.4, -5.1], // closed
    ])
  })

  it('keeps a ring that is already closed as it is', () => {
    const ring = parseArea('POLYGON ((1 2, 3 4, 5 6, 1 2))')
    expect(ring).toHaveLength(4)
    expect(ring?.[0]).toEqual([2, 1])
    expect(ring?.[3]).toEqual([2, 1])
  })

  it('tolerates extra spaces, no space after POLYGON and lower case', () => {
    expect(parseArea('  polygon((1 2,3 4 ,  5 6))  ')).toHaveLength(4)
  })

  it('reads a circle as 32 points around the centre, radius in metres', () => {
    const ring = parseArea('CIRCLE (-5.14 119.41, 250)')
    expect(ring).toHaveLength(33)
    expect(ring?.[0]).toEqual(ring?.[32])
    for (const [lon, lat] of ring ?? []) expect(Math.abs(haversineM(-5.14, 119.41, lat, lon) - 250)).toBeLessThan(2)
  })

  it('circleToRing puts the first point due north of the centre', () => {
    const [lon, lat] = circleToRing(10, 20, 1000)[0]
    expect(lon).toBeCloseTo(20, 6)
    expect(lat).toBeGreaterThan(10)
  })

  it.each([
    ['LINESTRING (1 2, 3 4)'],
    ['POLYGON ((1 2, 3 4))'], // too few points
    ['POLYGON ((1 2, 3 x, 5 6))'],
    ['POLYGON ((1 2 3, 4 5 6, 7 8 9))'],
    ['POLYGON ((95 2, 3 4, 5 6))'], // latitude out of range: probably lon/lat order
    ['POLYGON (('],
    ['CIRCLE (1 2)'],
    ['CIRCLE (1 2, -5)'],
    ['CIRCLE (1 2, abc)'],
    [''],
    [null],
    [42],
  ])('skips %s', (area) => {
    expect(parseArea(area)).toBeNull()
  })

  it('round-trips through ringToPolygonWkt', () => {
    const ring: [number, number][] = [
      [119.4, -5.1],
      [119.5, -5.1],
      [119.5, -5.2],
      [119.4, -5.1],
    ]
    expect(parseArea(ringToPolygonWkt(ring))).toEqual(ring)
  })
})
