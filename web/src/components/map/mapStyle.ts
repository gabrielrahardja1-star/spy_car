// Custom light basemap style (PLAN.md 2.2), drawn from OpenFreeMap's OpenMapTiles vector tiles. No API key.
import type { StyleSpecification } from 'maplibre-gl'

export const TILES_URL = 'https://tiles.openfreemap.org/planet'
export const TRAIL_SOURCE = 'trail'
export const SITE_SOURCE = 'site'
/** Route history: the whole trip, drawn as a dotted line under the driven part. */
export const TRAIL_AHEAD_SOURCE = 'trail-ahead'

const GROUND = '#DFE9F8'
const ROAD = '#F7FAFF'
const ORANGE = '#B45F06'
const BLUE = '#1D6FE8'
const SLATE = '#7C89AB'

/** Buildings without height data (common outside town) still get a low flat-roofed block. */
const DEFAULT_HEIGHT = 7

export function buildMapStyle(): StyleSpecification {
  return {
    version: 8,
    // Tilted light so walls read in two shades (PLAN.md 2.2 "two shades for depth").
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.45, position: [1.4, 210, 45] },
    sources: {
      openmaptiles: { type: 'vector', url: TILES_URL },
      [TRAIL_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      [TRAIL_AHEAD_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      [SITE_SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': GROUND } },
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        paint: { 'fill-color': '#D5E4F6', 'fill-opacity': 0.8 },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': '#D5E4F6', 'fill-opacity': 0.8 },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': '#C6DAF4' },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ROAD,
          'line-width': [
            'interpolate',
            ['exponential', 1.6],
            ['zoom'],
            8, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 1.4, 0.5],
            14, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 9, ['secondary', 'tertiary'], 6, 3],
            18, ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], 36, ['secondary', 'tertiary'], 26, 12],
          ],
        },
      },
      {
        id: 'site-fill',
        type: 'fill',
        source: SITE_SOURCE,
        paint: { 'fill-color': ORANGE, 'fill-opacity': 0.06 },
      },
      {
        id: 'site-outline',
        type: 'line',
        source: SITE_SOURCE,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': ORANGE, 'line-opacity': 0.8, 'line-width': 2, 'line-dasharray': [4, 4] },
      },
      {
        // Not yet driven: grey-blue dots (5px, 2px dash and 12px pitch as in the design; dash units are line widths).
        id: 'trail-ahead',
        type: 'line',
        source: TRAIL_AHEAD_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': SLATE, 'line-width': 5, 'line-dasharray': [0.4, 2.4] },
      },
      {
        id: 'trail-glow',
        type: 'line',
        source: TRAIL_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': BLUE, 'line-opacity': 0.25, 'line-width': 18 },
      },
      {
        id: 'trail',
        type: 'line',
        source: TRAIL_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': BLUE, 'line-width': 6 },
      },
      {
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#F3F7FD',
          'fill-extrusion-height': ['max', ['coalesce', ['get', 'render_height'], DEFAULT_HEIGHT], 3],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.96,
          'fill-extrusion-vertical-gradient': true,
        },
      },
    ],
  }
}
