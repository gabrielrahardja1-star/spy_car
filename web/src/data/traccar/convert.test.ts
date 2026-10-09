import { describe, expect, it } from 'vitest'
import type { Config } from '../../config'
import { config } from '../../config'
import type { Geofence } from '../types'
import { toCar, toGeofences, toPosition, toTrip } from './convert'

const cfg: Config = { ...config, siteGeofenceName: 'Site' }

describe('toPosition', () => {
  const base = { deviceId: 7, fixTime: '2026-10-08T06:00:00Z', latitude: -5.1, longitude: 119.4, speed: 10, course: 90 }

  it('converts knots to km/h, ISO time to ms and the device id to a car id', () => {
    const p = toPosition(base, cfg)
    expect(p).toMatchObject({ carId: '7', fixTime: Date.UTC(2026, 9, 8, 6), lat: -5.1, lon: 119.4, course: 90 })
    expect(p?.speedKmh).toBeCloseTo(18.52, 6)
  })

  it('takes motion from the attribute when present, even against the speed', () => {
    expect(toPosition({ ...base, speed: 0, attributes: { motion: true } }, cfg)?.motion).toBe(true)
    expect(toPosition({ ...base, speed: 30, attributes: { motion: false } }, cfg)?.motion).toBe(false)
  })

  it('falls back to the speed threshold when there is no motion attribute', () => {
    expect(toPosition({ ...base, speed: 1 }, cfg)?.motion).toBe(false) // 1.852 km/h <= 3
    expect(toPosition({ ...base, speed: 2 }, cfg)?.motion).toBe(true) // 3.704 km/h > 3
  })

  it('treats a missing speed or course as 0', () => {
    const p = toPosition({ deviceId: 1, fixTime: base.fixTime, latitude: 1, longitude: 2 }, cfg)
    expect(p).toMatchObject({ speedKmh: 0, course: 0, motion: false })
  })

  it('drops fixes with a bad time, bad coordinates or the 0,0 no-lock position', () => {
    expect(toPosition({ ...base, fixTime: 'yesterday' }, cfg)).toBeNull()
    expect(toPosition({ ...base, latitude: Number.NaN }, cfg)).toBeNull()
    expect(toPosition({ ...base, latitude: 0, longitude: 0 }, cfg)).toBeNull()
    expect(toPosition({ ...base, latitude: 0, longitude: 5 }, cfg)).not.toBeNull()
  })
})

describe('toCar', () => {
  it('uses the device name and an optional driver attribute', () => {
    expect(toCar({ id: 3, name: 'Car 01' })).toEqual({ id: '3', name: 'Car 01', driver: '' })
    expect(toCar({ id: 3, name: 'Car 01', attributes: { driver: 'D1' } }).driver).toBe('D1')
    expect(toCar({ id: 3, name: 'Car 01', attributes: { driverName: ' D2 ' } }).driver).toBe('D2')
    expect(toCar({ id: 3, name: 'Car 01', attributes: { driver: '  ' } }).driver).toBe('')
  })
})

describe('toGeofences', () => {
  const list = [
    { id: 1, name: 'SITE', area: 'POLYGON ((1 1, 1 2, 2 2, 2 1))' },
    { id: 2, name: 'Depot', area: 'CIRCLE (5 5, 100)' },
    { id: 3, name: 'Broken', area: 'POLYGON ((nope))' },
    { id: 4, name: 'Route', area: 'LINESTRING (1 1, 2 2)' },
  ]

  it('marks only the geofence with the configured name (case-insensitive) as the site; skips unusable shapes', () => {
    const out = toGeofences(list, cfg)
    expect(out.map((g) => [g.name, g.kind])).toEqual([
      ['SITE', 'site'],
      ['Depot', 'place'],
    ])
    expect(out[0].polygon[0]).toEqual([1, 1])
    expect(out[1].polygon).toHaveLength(33)
  })

  it('follows a different configured site name, and no geofence is the site when none matches', () => {
    expect(toGeofences(list, { ...cfg, siteGeofenceName: 'depot' }).map((g) => g.kind)).toEqual(['place', 'site'])
    expect(toGeofences(list, { ...cfg, siteGeofenceName: 'Elsewhere' }).every((g) => g.kind === 'place')).toBe(true)
  })
})

describe('toTrip', () => {
  const site: Geofence = {
    id: '1',
    name: 'Site',
    kind: 'site',
    polygon: [[119.4, -5.1], [119.5, -5.1], [119.5, -5.2], [119.4, -5.2], [119.4, -5.1]],
  }
  const raw = {
    deviceId: 2,
    startTime: '2026-10-08T00:00:00Z',
    endTime: '2026-10-08T00:30:00Z',
    distance: 12345.6,
    duration: 1800, // documented as seconds, sent as ms: must not be used
    maxSpeed: 20,
    startLat: -5.15,
    startLon: 119.45,
    endLat: -6,
    endLon: 120,
  }

  it('maps units, places and ids; the duration comes from the times', () => {
    const t = toTrip(raw, [site])
    expect(t).toMatchObject({
      id: '2-' + Date.UTC(2026, 9, 8),
      carId: '2',
      startTime: Date.UTC(2026, 9, 8),
      endTime: Date.UTC(2026, 9, 8, 0, 30),
      startPlace: 'Site',
      endPlace: null,
      distanceM: 12346,
      drivingMs: 30 * 60_000,
      stops: [],
    })
    expect(t?.maxSpeedKmh).toBeCloseTo(37.04, 6)
    expect(t).not.toHaveProperty('startAddress')
  })

  it('keeps non-empty server addresses as optional extras', () => {
    const t = toTrip({ ...raw, startAddress: ' Main St ', endAddress: '' }, [site])
    expect(t?.startAddress).toBe('Main St')
    expect(t).not.toHaveProperty('endAddress')
  })

  it('rejects trips with unusable times', () => {
    expect(toTrip({ ...raw, endTime: 'x' }, [site])).toBeNull()
    expect(toTrip({ ...raw, endTime: '2026-10-07T00:00:00Z' }, [site])).toBeNull()
  })
})
