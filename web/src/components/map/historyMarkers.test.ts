import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCarMarkerElement, createTripMarkerElement } from './historyMarkers'

describe('createTripMarkerElement', () => {
  it('names itself and shows the label pill', () => {
    const el = createTripMarkerElement('stop', 'Stop · 3 min', 'left')
    expect(el.getAttribute('role')).toBe('img')
    expect(el.getAttribute('aria-label')).toBe('Stop · 3 min')
    expect(el.textContent).toBe('Stop · 3 min')
  })

  it('uses classList, so classes maplibre adds before or after survive', () => {
    const el = createTripMarkerElement('start', 'Start 07:42', 'right')
    el.classList.add('maplibregl-marker', 'maplibregl-marker-anchor-center')
    expect(el.classList.contains('maplibregl-marker-anchor-center')).toBe(true)
    expect(el.classList.length).toBeGreaterThanOrEqual(3)
  })
})

describe('createCarMarkerElement', () => {
  it('keeps the classes maplibre puts on a marker element, including the anchor', () => {
    const { el, update } = createCarMarkerElement()
    el.classList.add('maplibregl-marker', 'maplibregl-marker-anchor-center')
    update('Car 01 at 08:14', '47 km/h · 16 km in')
    update('Car 01 at 08:15', '48 km/h · 17 km in')
    expect(el.classList.contains('maplibregl-marker')).toBe(true)
    expect(el.classList.contains('maplibregl-marker-anchor-center')).toBe(true)
  })

  it('writes the callout text and an accessible name', () => {
    const { el, update } = createCarMarkerElement()
    update('Car 01 at 08:14', '47 km/h · 16 km in')
    expect(el.textContent).toContain('Car 01 at 08:14')
    expect(el.textContent).toContain('47 km/h · 16 km in')
    expect(el.getAttribute('aria-label')).toBe('Car 01 at 08:14. 47 km/h · 16 km in')
  })

  it('shows the flat dot only when asked (3D model unavailable)', () => {
    const { el, setFlat } = createCarMarkerElement()
    const dot = el.firstElementChild as HTMLElement
    expect(dot.hidden).toBe(true)
    setFlat(true)
    expect(dot.hidden).toBe(false)
  })
})

describe('history map stylesheet', () => {
  const css = readFileSync('src/components/map/HistoryMapView.module.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') // vitest runs from the web/ folder
  /** Every declaration block whose selector list includes `.name`. */
  const blocks = (name: string) =>
    [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selectors]) => selectors.split(',').some((sel) => sel.trim() === `.${name}`))
      .map(([, , body]) => body)

  it.each(['marker', 'start', 'end', 'stop', 'carMarker'])(
    'does not set `position` on .%s: that would override maplibre\'s absolute markers and stack them in the page flow',
    (name) => {
      expect(blocks(name).length).toBeGreaterThan(0)
      for (const body of blocks(name)) expect(body).not.toMatch(/position\s*:/)
    },
  )

  it('positions only the children of a marker (pills, callout, flat dot)', () => {
    for (const name of ['pill', 'carCallout', 'carFlat']) expect(blocks(name).join(';')).toMatch(/position\s*:\s*absolute/)
  })
})
