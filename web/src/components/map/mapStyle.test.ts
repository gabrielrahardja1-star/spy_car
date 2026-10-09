import { describe, expect, it } from 'vitest'
import { SITE_SOURCE, TRAIL_AHEAD_SOURCE, TRAIL_SOURCE, buildMapStyle } from './mapStyle'

describe('buildMapStyle', () => {
  const style = buildMapStyle()
  const layer = (id: string) => style.layers.find((l) => l.id === id)

  it('uses the design ground and road colours (PLAN.md 2.2)', () => {
    expect(layer('ground')).toMatchObject({ paint: { 'background-color': '#DFE9F8' } })
    expect(layer('roads')).toMatchObject({ paint: { 'line-color': '#F7FAFF' } })
  })

  it('draws the trail 6px blue with a wider 25% glow', () => {
    expect(layer('trail')).toMatchObject({ paint: { 'line-color': '#1D6FE8', 'line-width': 6 } })
    expect(layer('trail-glow')).toMatchObject({ paint: { 'line-opacity': 0.25, 'line-width': 18 } })
  })

  it('draws the not-yet-driven route as a grey-blue dotted line under the driven one', () => {
    expect(layer('trail-ahead')).toMatchObject({ source: TRAIL_AHEAD_SOURCE, paint: { 'line-color': '#7C89AB', 'line-width': 5 } })
    expect(layer('trail-ahead')?.paint).toHaveProperty('line-dasharray')
    const ids = style.layers.map((l) => l.id)
    expect(ids.indexOf('trail-ahead')).toBeLessThan(ids.indexOf('trail-glow'))
    expect(ids.indexOf('trail-glow')).toBeLessThan(ids.indexOf('trail'))
  })

  it('draws the site zone with a 6% orange fill and a dashed outline', () => {
    expect(layer('site-fill')).toMatchObject({ paint: { 'fill-color': '#B45F06', 'fill-opacity': 0.06 } })
    expect(layer('site-outline')).toMatchObject({ paint: { 'line-color': '#B45F06' } })
    expect(layer('site-outline')?.paint).toHaveProperty('line-dasharray')
  })

  it('extrudes buildings, with a default height where the data has none', () => {
    const b = layer('buildings') as { type: string; paint: Record<string, unknown> }
    expect(b.type).toBe('fill-extrusion')
    expect(JSON.stringify(b.paint['fill-extrusion-height'])).toContain('render_height')
  })

  it('has the geojson sources the map fills in at runtime and needs no API key', () => {
    expect(style.sources[TRAIL_SOURCE]).toMatchObject({ type: 'geojson' })
    expect(style.sources[TRAIL_AHEAD_SOURCE]).toMatchObject({ type: 'geojson' })
    expect(style.sources[SITE_SOURCE]).toMatchObject({ type: 'geojson' })
    expect(JSON.stringify(style)).not.toMatch(/key=|apikey|access_token/i)
  })
})
