// Name labels for the site zone and other named places, shared by the Live map and Route history.
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap, Marker } from 'maplibre-gl'
import type { Geofence } from '../../data/types'
import styles from './LiveMapView.module.css'
import { centroid, southEdge } from './mapGeometry'
import { createLabelElement } from './pinElement'

/** Adds one label per geofence: "<SITE> ZONE" under the zone outline, a pill at the middle of any other place. */
export function addPlaceMarkers(map: MapLibreMap, geofences: Geofence[]): Marker[] {
  return geofences.map((g) => {
    const isSite = g.kind === 'site'
    const el = createLabelElement(isSite ? `${g.name.toUpperCase()} ZONE` : g.name, isSite ? styles.zone : styles.place)
    return new maplibregl.Marker({ element: el, anchor: isSite ? 'top' : 'center' })
      .setLngLat(isSite ? southEdge(g.polygon) : centroid(g.polygon))
      .addTo(map)
  })
}
