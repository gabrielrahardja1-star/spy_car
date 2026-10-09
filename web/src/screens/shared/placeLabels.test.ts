import { describe, expect, it } from 'vitest'
import type { LiveCar } from '../../data/types'
import { CAR_1, position, trip } from '../../test/fakeSource'
import { localTime } from '../../test/render'
import { DEPOT, SITE_ZONE } from '../../test/scenario'
import { contextOf } from '../LiveMap/liveText'
import { eventsOf } from '../RouteHistory/events'

const NOW = localTime(14, 18)
const todayStart = localTime(0, 0)
const geofences = [SITE_ZONE, DEPOT]

function live(status: LiveCar['status'], over: Partial<LiveCar> = {}): LiveCar {
  return { car: CAR_1, position: position(CAR_1.id, NOW - 4000, { lat: 5, lon: 5 }), status, lastSeenMs: 4000, parkedForMs: null, ...over }
}
const ctx = (l: LiveCar, trips = [] as ReturnType<typeof trip>[]) => contextOf({ live: l, trips, geofences, now: NOW, todayStart }).text

describe('Live map context line', () => {
  it('moving from an unnamed place: "Away from site · left 13:20"', () => {
    expect(ctx(live('moving'), [trip(CAR_1.id, localTime(13, 20), null, { startPlace: null, endPlace: null })])).toBe('Away from site · left 13:20')
  })

  it('moving away from a named place: "From Site · left 13:20"', () => {
    expect(ctx(live('moving'), [trip(CAR_1.id, localTime(13, 20), null, { startPlace: 'Site', endPlace: null })])).toBe('From Site · left 13:20')
  })

  it('moving along a finished trip between known ends', () => {
    expect(ctx(live('moving'), [trip(CAR_1.id, localTime(13, 20), localTime(13, 50), { startPlace: null, endPlace: 'Site' })])).toBe('Away → Site · left 13:20')
  })

  it('parked outside every geofence: "Away from site · arrived 13:40"', () => {
    const parked = live('parked', { parkedForMs: 38 * 60_000, position: position(CAR_1.id, NOW - 4000, { lat: 50, lon: 50 }) })
    expect(ctx(parked, [trip(CAR_1.id, localTime(13, 0), localTime(13, 40), { startPlace: null, endPlace: null })])).toBe('Away from site · arrived 13:40')
  })

  it('parked inside the Site zone or another named place still reads as before', () => {
    const inSite = live('parked', { position: position(CAR_1.id, NOW - 4000, { lat: 0, lon: 0 }) })
    expect(ctx(inSite, [trip(CAR_1.id, localTime(13, 0), localTime(13, 40))])).toBe('Inside Site zone · arrived 13:40')
    const inDepot = live('parked', { position: position(CAR_1.id, NOW - 4000, { lat: 10.5, lon: 10.5 }) })
    expect(ctx(inDepot, [trip(CAR_1.id, localTime(13, 0), localTime(13, 40))])).toBe('At Town depot · arrived 13:40')
  })
})

describe('Route history timeline', () => {
  const texts = (t: ReturnType<typeof trip>) => eventsOf(t, geofences).map((e) => e.text)
  const t = (over: object) => trip(CAR_1.id, localTime(8, 0), localTime(9, 0), over)

  it('starting and ending away from every geofence', () => {
    expect(texts(t({ startPlace: null, endPlace: null }))).toEqual(['Started away from site', 'Stopped away from site'])
  })

  it('leaving the Site zone and ending away', () => {
    expect(texts(t({ startPlace: 'Site', endPlace: null }))).toEqual(['Left Site zone', 'Stopped away from site'])
  })

  it('coming back to the Site zone', () => {
    expect(texts(t({ startPlace: null, endPlace: 'Site' }))).toEqual(['Started away from site', 'Arrived at Site zone'])
  })

  it('named non-site places keep their plain wording', () => {
    expect(texts(t({ startPlace: 'Town depot', endPlace: 'Town depot' }))).toEqual(['Left Town depot', 'Arrived Town depot'])
  })

  it('a trip under way has no arrival', () => {
    expect(texts(trip(CAR_1.id, localTime(8, 0), null, { startPlace: null, endPlace: null }))).toEqual(['Started away from site'])
  })
})
