import { describe, expect, it } from 'vitest'
import { trip } from '../../test/fakeSource'
import { AWAY_FROM_SITE, placeName, stopsCount, stopsSummary, tripAddressLine, tripRoute, tripTitle } from './tripText'

const T = 1_000_000

describe('place wording (only the Site zone is drawn; everything else is "away")', () => {
  it('names a missing place "Away from site"', () => {
    expect(AWAY_FROM_SITE).toBe('Away from site')
    expect(placeName(null)).toBe('Away from site')
    expect(placeName('Site')).toBe('Site')
  })

  it('titles trips with an arrow: Site → away, Away → Site, Away → away', () => {
    expect(tripTitle(trip('c', T, T + 1, { startPlace: 'Site', endPlace: null }))).toBe('Site → away')
    expect(tripTitle(trip('c', T, T + 1, { startPlace: null, endPlace: 'Site' }))).toBe('Away → Site')
    expect(tripTitle(trip('c', T, T + 1, { startPlace: null, endPlace: null }))).toBe('Away → away')
  })

  it('still titles trips between named places (the mock has Town depot and Supplier yard)', () => {
    expect(tripTitle(trip('c', T, T + 1, { startPlace: 'Site', endPlace: 'Town depot' }))).toBe('Site → Town depot')
    expect(tripRoute('Supplier yard', 'Site')).toBe('Supplier yard → Site')
  })

  it('titles a trip under way without a destination as "<start>, on the way"', () => {
    expect(tripTitle(trip('c', T, null, { startPlace: 'Site', endPlace: null }))).toBe('Site, on the way')
    expect(tripTitle(trip('c', T, null, { startPlace: null, endPlace: null }))).toBe('Away from site, on the way')
  })
})

describe('tripAddressLine', () => {
  it('shows server addresses only for ends that matched no geofence', () => {
    const t = (over: object) => trip('c', T, T + 1, over)
    expect(tripAddressLine(t({ startPlace: null, endPlace: null, startAddress: 'A St', endAddress: 'B St' }))).toBe('From A St to B St')
    expect(tripAddressLine(t({ startPlace: null, endPlace: null, startAddress: 'A St' }))).toBe('From A St')
    expect(tripAddressLine(t({ startPlace: 'Site', endPlace: null, startAddress: 'A St', endAddress: 'B St' }))).toBe('To B St')
    expect(tripAddressLine(t({ startPlace: 'Site', endPlace: 'Town depot', startAddress: 'A', endAddress: 'B' }))).toBeNull()
    expect(tripAddressLine(t({ startPlace: null, endPlace: null }))).toBeNull()
  })

  it('does not show a destination address for a trip still under way', () => {
    expect(tripAddressLine(trip('c', T, null, { startPlace: null, endPlace: null, startAddress: 'A St', endAddress: 'B St' }))).toBe('From A St')
  })
})

describe('stops when they could not be worked out', () => {
  it('shows an em dash instead of a misleading 0', () => {
    expect(stopsCount(trip('c', T, T + 1, { stopsKnown: false }))).toBe('—')
    expect(stopsSummary(trip('c', T, T + 1, { stopsKnown: false }))).toBe('—')
    expect(stopsCount(trip('c', T, T + 1))).toBe('0')
    expect(stopsSummary(trip('c', T, T + 1))).toBe('0')
  })
})
