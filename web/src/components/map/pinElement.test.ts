import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { MapPin } from './mapGeometry'
import { createPinElement } from './pinElement'

const pin: MapPin = { id: 'c1', index: 0, name: 'Car 01', status: 'moving', detail: '42 km/h · 4 s ago', position: [0, 0], fixTime: 1, course: 0 }

describe('createPinElement', () => {
  it('keeps the classes maplibre puts on a marker element, including the anchor', () => {
    const { el, update } = createPinElement(() => {})
    el.classList.add('maplibregl-marker', 'maplibregl-marker-anchor-bottom')
    update(pin, true)
    update({ ...pin, status: 'parked' }, false)
    expect(el.classList.contains('maplibregl-marker')).toBe(true)
    expect(el.classList.contains('maplibregl-marker-anchor-bottom')).toBe(true)
  })

  it('shows one status class at a time and the selected state', () => {
    const { el, update } = createPinElement(() => {})
    update(pin, true)
    const withSelected = el.className
    update({ ...pin, status: 'nosignal' }, false)
    expect(el.className).not.toBe(withSelected)
    expect(el.getAttribute('aria-label')).toBe('Car 01, no signal. 42 km/h · 4 s ago')
  })

  it('numbers the badge from the car order and writes the callout text', () => {
    const { el, update } = createPinElement(() => {})
    update({ ...pin, index: 1, name: 'Car 02' }, false)
    expect(el.textContent).toContain('02')
    expect(el.textContent).toContain('Car 02 · Moving')
    expect(el.textContent).toContain('42 km/h · 4 s ago')
  })

  it('shows the flat dot only when asked (3D model unavailable)', () => {
    const { el, setFlat, update } = createPinElement(() => {})
    update(pin, false)
    const dot = el.firstElementChild as HTMLElement
    expect(dot.hidden).toBe(true)
    setFlat(true)
    expect(dot.hidden).toBe(false)
  })

  it('calls back when clicked', () => {
    let clicks = 0
    const { el } = createPinElement(() => clicks++)
    el.click()
    expect(clicks).toBe(1)
  })
})

describe('pin stylesheet', () => {
  const css = readFileSync('src/components/map/LiveMapView.module.css', 'utf8') // vitest runs from the web/ folder
  it('does not set `position` on the pin: that would override maplibre\'s absolute markers and stack the pins', () => {
    const block = /\.pin\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).not.toMatch(/position\s*:/)
  })
})
