// The real Live map: MapLibre with a tilted 3D light style, car pins that glide between pings,
// today's trail for the selected car, the site zone and named places. Loaded lazily by LiveMapSurface.
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Geofence } from '../../data/types'
import type { MapMode } from '../ui/MapOverlays'
import styles from './LiveMapView.module.css'
import { GLIDE_MAX_M, boundsOf, distanceM, glideAngle, glideAt, siteFeatures, trailFeature, type LngLat, type MapPin } from './mapGeometry'
import type { CarOverlay } from './carLayer'
import { modelFor } from './carModels'
import { SITE_SOURCE, TRAIL_SOURCE, buildMapStyle } from './mapStyle'
import { addPlaceMarkers } from './placeMarkers'
import { createPinElement, type PinElement } from './pinElement'

export interface MapHandle {
  /** Frame every car that has a position. */
  fitCars(): void
  zoomBy(delta: number): void
}

export interface LiveMapViewProps {
  pins: MapPin[]
  selectedId: string | null
  geofences: Geofence[]
  /** Today's trail for the selected car. */
  trail: LngLat[]
  mode: MapMode
  onSelect: (id: string) => void
  /** Called if the map cannot start (no WebGL, style failed), so the caller can show a fallback. */
  onFail: () => void
  ref?: Ref<MapHandle>
}

const PITCH_3D = 55
const BEARING_3D = -20
const SELECT_ZOOM = 15
const DEFAULT_CENTER: LngLat = [119.41, -5.14]
const MIN_GLIDE_MS = 600
const MAX_GLIDE_MS = 3000

interface PinState {
  marker: Marker
  view: PinElement
  /** Where the marker is drawn right now. */
  shown: LngLat
  index: number
  /** Heading drawn right now, and the headings it turns between. */
  shownCourse: number
  fromCourse: number
  toCourse: number
  from: LngLat
  to: LngLat
  start: number
  duration: number
  /** Time the last position change arrived, to size the next glide. */
  arrivedAt: number
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export function LiveMapView({ pins, selectedId, geofences, trail, mode, onSelect, onFail, ref }: LiveMapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const states = useRef(new Map<string, PinState>())
  const raf = useRef(0)
  const placeMarkers = useRef<Marker[]>([])
  const positioned = useRef(false)
  const lastSelected = useRef<string | null>(null)
  const carsOverlay = useRef<CarOverlay | null>(null)
  // True while no 3D model can be shown (deck.gl or the model failed): pins show a flat dot instead.
  const flat = useRef(false)

  // Latest props for callbacks that outlive a render (map events, animation frames, the imperative handle).
  const latest = useRef({ pins, onSelect, onFail, selectedId, mode })
  useEffect(() => {
    latest.current = { pins, onSelect, onFail, selectedId, mode }
  })

  useImperativeHandle(ref, () => ({
    fitCars() {
      const map = mapRef.current
      if (!map) return
      const points = [...states.current.values()].map((s) => s.to)
      const box = boundsOf(points)
      if (!box) return
      if (points.length === 1 || (box[0][0] === box[1][0] && box[0][1] === box[1][1])) {
        map.flyTo({ center: box[0], zoom: SELECT_ZOOM })
      } else {
        map.fitBounds(box, { padding: { top: 150, bottom: 130, left: 90, right: 90 }, maxZoom: 16 })
      }
    },
    zoomBy(delta) {
      mapRef.current?.zoomTo((mapRef.current.getZoom() ?? 0) + delta)
    },
  }))

  // Create the map once.
  useEffect(() => {
    const el = container.current
    if (!el) return
    let map: MapLibreMap
    try {
      const first = latest.current.pins.find((p) => p.position)?.position
      map = new maplibregl.Map({
        container: el,
        style: buildMapStyle(),
        center: first ?? DEFAULT_CENTER,
        zoom: first ? SELECT_ZOOM : 12,
        pitch: latest.current.mode === '3d' ? PITCH_3D : 0,
        bearing: latest.current.mode === '3d' ? BEARING_3D : 0,
        maxPitch: 70,
        attributionControl: false,
      })
    } catch {
      latest.current.onFail()
      return
    }
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left')
    // The style is inline, so pins and overlays need only the parsed style, not every tile (slow signal on site).
    map.on('style.load', () => setReady(true))
    map.on('load', () => setReady(true))
    // A tile or two failing is normal on patchy signal; only a style that never loads is fatal.
    map.on('error', (e) => {
      if (!map.isStyleLoaded() && /style|source/i.test(String(e.error?.message))) latest.current.onFail()
    })
    mapRef.current = map
    const pinStates = states.current
    return () => {
      cancelAnimationFrame(raf.current)
      pinStates.forEach((s) => s.marker.remove())
      pinStates.clear()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [])

  const drawCars = () => {
    carsOverlay.current?.setCars(
      [...states.current.entries()].map(([id, s]) => ({
        id,
        model: modelFor(s.index),
        position: s.shown,
        heading: s.shownCourse,
      })),
    )
  }

  // Animation loop: advance every gliding marker and car model, stop when all have arrived.
  const tick = useRef<() => void>(() => {})
  useEffect(() => {
    tick.current = () => {
      const now = performance.now()
      let moving = false
      states.current.forEach((s) => {
        const t = s.duration > 0 ? (now - s.start) / s.duration : 1
        s.shown = glideAt(s.from, s.to, t)
        s.shownCourse = glideAngle(s.fromCourse, s.toCourse, t)
        s.marker.setLngLat(s.shown)
        if (t < 1) moving = true
      })
      drawCars()
      raf.current = moving ? requestAnimationFrame(tick.current) : 0
    }
  })

  // 3D car models. If deck.gl or a model cannot load, the pins fall back to a flat dot.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    let cancelled = false
    const useFlat = () => {
      flat.current = true
      states.current.forEach((s) => s.view.setFlat(true))
    }
    import('./carLayer')
      .then(({ createCarOverlay }) => {
        if (cancelled) return
        const cars = createCarOverlay(useFlat)
        map.addControl(cars.overlay)
        carsOverlay.current = cars
        drawCars()
      })
      .catch(useFlat)
    return () => {
      cancelled = true
      if (carsOverlay.current) {
        map.removeControl(carsOverlay.current.overlay)
        carsOverlay.current = null
      }
    }
    // drawCars only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  // Pins: create, update text and status, and glide towards new positions.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const seen = new Set<string>()
    const now = performance.now()
    for (const pin of pins) {
      seen.add(pin.id)
      let s = states.current.get(pin.id)
      if (!pin.position) {
        if (s) {
          s.marker.remove()
          states.current.delete(pin.id)
        }
        continue
      }
      if (!s) {
        const view = createPinElement(() => latest.current.onSelect(pin.id))
        const marker = new maplibregl.Marker({ element: view.el, anchor: 'bottom' }).setLngLat(pin.position).addTo(map)
        const course = pin.course ?? 0
        view.setFlat(flat.current)
        s = {
          marker, view, index: pin.index, shown: pin.position, from: pin.position, to: pin.position,
          shownCourse: course, fromCourse: course, toCourse: course, start: now, duration: 0, arrivedAt: now,
        }
        states.current.set(pin.id, s)
      } else if (s.to[0] !== pin.position[0] || s.to[1] !== pin.position[1]) {
        const jump = reducedMotion() || distanceM(s.shown, pin.position) > GLIDE_MAX_M
        s.from = s.shown
        s.to = pin.position
        s.fromCourse = s.shownCourse
        s.toCourse = pin.course ?? s.shownCourse
        s.start = now
        // Glide for about as long as the gap since the previous ping, so motion looks continuous.
        s.duration = jump ? 0 : Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, now - s.arrivedAt))
        s.arrivedAt = now
        if (jump) {
          s.shown = pin.position
          s.shownCourse = s.toCourse
          s.marker.setLngLat(pin.position)
        } else if (!raf.current) {
          raf.current = requestAnimationFrame(tick.current)
        }
      }
      s.index = pin.index
      s.view.update(pin, pin.id === selectedId)
    }
    states.current.forEach((s, id) => {
      if (!seen.has(id)) {
        s.marker.remove()
        states.current.delete(id)
      }
    })

    drawCars()

    // First time we know where the selected car is, put the camera on it.
    if (!positioned.current) {
      const sel = pins.find((p) => p.id === selectedId)?.position ?? pins.find((p) => p.position)?.position
      if (sel) {
        map.jumpTo({ center: sel, zoom: SELECT_ZOOM })
        positioned.current = true
        lastSelected.current = selectedId
      }
    }
  }, [pins, selectedId, ready])

  // Selecting another car flies the map to it.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !positioned.current || selectedId === lastSelected.current) return
    lastSelected.current = selectedId
    const target = states.current.get(selectedId ?? '')?.to
    if (target) map.flyTo({ center: target, zoom: Math.max(map.getZoom(), SELECT_ZOOM) })
  }, [selectedId, ready])

  // 2D / 3D
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.easeTo({ pitch: mode === '3d' ? PITCH_3D : 0, bearing: mode === '3d' ? BEARING_3D : 0, duration: 700 })
  }, [mode, ready])

  // Trail and site zone data
  useEffect(() => {
    if (!ready) return
    mapRef.current?.getSource<GeoJSONSource>(TRAIL_SOURCE)?.setData(trailFeature(trail))
  }, [trail, ready])

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return
    map.getSource<GeoJSONSource>(SITE_SOURCE)?.setData(siteFeatures(geofences))
    // Labels for the site zone and named places.
    placeMarkers.current.forEach((m) => m.remove())
    placeMarkers.current = addPlaceMarkers(map, geofences)
  }, [geofences, ready])

  return <div ref={container} className={styles.map} />
}
