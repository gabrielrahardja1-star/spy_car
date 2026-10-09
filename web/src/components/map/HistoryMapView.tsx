// The real Route history map: the selected trip's route on the same tilted 3D style as the Live map, with start,
// stop and end markers and the car at the playback position. Loaded lazily by HistoryMapSurface.
import * as maplibregl from 'maplibre-gl'
import type { CameraOptions, GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { Geofence } from '../../data/types'
import type { MapMode } from '../ui/MapOverlays'
import type { CarOverlay } from './carLayer'
import { modelFor } from './carModels'
import { createCarMarkerElement, createTripMarkerElement, type CarMarkerElement, type PillSide, type TripMarkerKind } from './historyMarkers'
import styles from './HistoryMapView.module.css'
import { boundsOf, siteFeatures, trailFeature, type LngLat } from './mapGeometry'
import { SITE_SOURCE, TRAIL_AHEAD_SOURCE, TRAIL_SOURCE, buildMapStyle } from './mapStyle'
import { addPlaceMarkers } from './placeMarkers'

export interface HistoryMapHandle {
  /** Frame the whole route again. */
  fitRoute(): void
  zoomBy(delta: number): void
}

export interface TripMarker {
  position: LngLat
  label: string
  side: PillSide
}

/** The car at the playback position. */
export interface HistoryCar {
  /** Zero-based car order, which picks the 3D model. */
  index: number
  position: LngLat
  /** Degrees clockwise from north. */
  course: number
  title: string
  detail: string
}

export interface HistoryMapViewProps {
  /** The whole trip in time order: drawn dotted, and framed when it changes. Keep the array stable between renders. */
  path: LngLat[]
  /** The part already driven, ending at the car: drawn blue on top of the dotted line. */
  driven: LngLat[]
  start: TripMarker | null
  /** Null for a trip still under way. */
  end: TripMarker | null
  stops: TripMarker[]
  car: HistoryCar | null
  geofences: Geofence[]
  /** Where to look while there is no route to frame (the site zone, say). */
  fallbackCenter: LngLat | null
  mode: MapMode
  /** Called if the map cannot start (no WebGL, style failed), so the caller can show a fallback. */
  onFail: () => void
  ref?: Ref<HistoryMapHandle>
}

const PITCH_3D = 55
const BEARING_3D = -20
const DEFAULT_CENTER: LngLat = [119.41, -5.14]
const SINGLE_POINT_ZOOM = 15
const FALLBACK_ZOOM = 13
const FIT_ANIMATION_MS = 900
const MAX_FIT_ZOOM = 16

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const MARKER_ANCHOR = 'center'

type Padding = Record<'top' | 'bottom' | 'left' | 'right', number>

/**
 * The camera that fits the whole route inside `padding` at the given tilt. maplibre's own fit ignores tilt (a tilted
 * view squashes the route's height, so it would leave it small), so this starts from that flat fit, then measures where
 * the route really lands on screen and zooms and shifts to fill the free area. Leaves the map where it was.
 */
function frameRoute(map: MapLibreMap, path: LngLat[], box: [LngLat, LngLat], padding: Padding, view: { pitch: number; bearing: number }): CameraOptions | null {
  const flat = map.cameraForBounds(box, { padding, bearing: view.bearing, maxZoom: MAX_FIT_ZOOM })
  if (!flat?.center || flat.zoom === undefined) return null
  const before: CameraOptions = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }
  const { width, height } = map.getContainer().getBoundingClientRect()
  const free = { width: width - padding.left - padding.right, height: height - padding.top - padding.bottom }
  const target = { x: padding.left + free.width / 2, y: padding.top + free.height / 2 }
  const extent = () => {
    const pts = path.map((p) => map.project(p))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    return { w: x1 - x0, h: y1 - y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  }
  map.jumpTo({ center: flat.center, zoom: flat.zoom, ...view })
  // Zooming changes the squash a little, so measure twice.
  for (let pass = 0; pass < 2; pass++) {
    const e = extent()
    const scale = Math.min(free.width / Math.max(e.w, 1), free.height / Math.max(e.h, 1))
    map.jumpTo({ zoom: Math.min(MAX_FIT_ZOOM, map.getZoom() + Math.log2(scale)) })
    const m = extent()
    map.jumpTo({ center: map.unproject([width / 2 + (m.x - target.x), height / 2 + (m.y - target.y)]) })
  }
  const camera: CameraOptions = { center: map.getCenter(), zoom: map.getZoom(), ...view }
  map.jumpTo(before)
  return camera
}

function drawCar(cars: CarOverlay | null, car: HistoryCar | null) {
  cars?.setCars(car ? [{ id: 'history-car', model: modelFor(car.index), position: car.position, heading: car.course }] : [])
}

export function HistoryMapView({ path, driven, start, end, stops, car, geofences, fallbackCenter, mode, onFail, ref }: HistoryMapViewProps) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const tripMarkers = useRef<Marker[]>([])
  const placeMarkers = useRef<Marker[]>([])
  const carMarker = useRef<{ marker: Marker; view: CarMarkerElement } | null>(null)
  const carsOverlay = useRef<CarOverlay | null>(null)
  // True while no 3D model can be shown (deck.gl or the model failed): the car shows a flat dot instead.
  const flat = useRef(false)
  const framed = useRef(false)

  // Latest props for callbacks that outlive a render (map events, the imperative handle, async overlay setup).
  const latest = useRef({ path, car, mode, onFail })
  useEffect(() => {
    latest.current = { path, car, mode, onFail }
  })

  const fit = (animate: boolean) => {
    const map = mapRef.current
    const box = boundsOf(latest.current.path)
    if (!map || !box) return
    const is3d = latest.current.mode === '3d'
    const view = { pitch: is3d ? PITCH_3D : 0, bearing: is3d ? BEARING_3D : 0 }
    const duration = animate && !reducedMotion() ? FIT_ANIMATION_MS : 0
    const move = (camera: CameraOptions) => (duration > 0 ? map.easeTo({ ...camera, duration }) : map.jumpTo(camera))
    if (box[0][0] === box[1][0] && box[0][1] === box[1][1]) {
      move({ center: box[0], zoom: SINGLE_POINT_ZOOM, ...view })
      return
    }
    // Room for the playback bar along the bottom, for the label pills (left of their points) and for the car's callout (right).
    const { width, height } = map.getContainer().getBoundingClientRect()
    const padding = {
      top: Math.min(90, height * 0.15),
      bottom: Math.min(200, height * 0.35),
      left: Math.min(170, width * 0.15),
      right: Math.min(240, width * 0.2),
    }
    const camera = frameRoute(map, latest.current.path, box, padding, view)
    if (camera) move(camera)
  }

  useImperativeHandle(ref, () => ({
    fitRoute: () => fit(true),
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
      const first = latest.current.path[0]
      map = new maplibregl.Map({
        container: el,
        style: buildMapStyle(),
        center: first ?? DEFAULT_CENTER,
        zoom: first ? SINGLE_POINT_ZOOM : 12,
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
    // The style is inline, so markers and overlays need only the parsed style, not every tile (slow signal on site).
    map.on('style.load', () => setReady(true))
    map.on('load', () => setReady(true))
    // A tile or two failing is normal on patchy signal; only a style that never loads is fatal.
    map.on('error', (e) => {
      if (!map.isStyleLoaded() && /style|source/i.test(String(e.error?.message))) latest.current.onFail()
    })
    mapRef.current = map
    const trip = tripMarkers.current
    const places = placeMarkers.current
    return () => {
      trip.forEach((m) => m.remove())
      places.forEach((m) => m.remove())
      trip.length = 0
      places.length = 0
      carMarker.current?.marker.remove()
      carMarker.current = null
      map.remove()
      mapRef.current = null
      framed.current = false
      setReady(false)
    }
  }, [])

  // 3D car model. If deck.gl or the model cannot load, the car shows a flat dot.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    let cancelled = false
    const useFlat = () => {
      flat.current = true
      carMarker.current?.view.setFlat(true)
    }
    import('./carLayer')
      .then(({ createCarOverlay }) => {
        if (cancelled) return
        const cars = createCarOverlay(useFlat)
        map.addControl(cars.overlay)
        carsOverlay.current = cars
        drawCar(cars, latest.current.car)
      })
      .catch(useFlat)
    return () => {
      cancelled = true
      if (carsOverlay.current) {
        map.removeControl(carsOverlay.current.overlay)
        carsOverlay.current = null
      }
    }
  }, [ready])

  // The car: callout, flat fallback and 3D model follow the playback position.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (!car) {
      carMarker.current?.marker.remove()
      carMarker.current = null
    } else {
      if (!carMarker.current) {
        const view = createCarMarkerElement()
        view.setFlat(flat.current)
        const marker = new maplibregl.Marker({ element: view.el, anchor: MARKER_ANCHOR }).setLngLat(car.position).addTo(map)
        carMarker.current = { marker, view }
      }
      carMarker.current.marker.setLngLat(car.position)
      carMarker.current.view.update(car.title, car.detail)
    }
    drawCar(carsOverlay.current, car)
  }, [car, ready])

  // Start, stop and end markers.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    tripMarkers.current.forEach((m) => m.remove())
    const add = (kind: TripMarkerKind, m: TripMarker) =>
      new maplibregl.Marker({ element: createTripMarkerElement(kind, m.label, m.side), anchor: MARKER_ANCHOR }).setLngLat(m.position).addTo(map)
    tripMarkers.current = [
      ...(start ? [add('start', start)] : []),
      ...stops.map((s) => add('stop', s)),
      ...(end ? [add('end', end)] : []),
    ]
  }, [start, end, stops, ready])

  // Frame the route when a new one arrives; with none, look at the fallback place.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (path.length > 0) {
      fit(framed.current)
      framed.current = true
    } else if (fallbackCenter) {
      const to = { center: fallbackCenter, zoom: FALLBACK_ZOOM }
      if (framed.current && !reducedMotion()) map.easeTo({ ...to, duration: FIT_ANIMATION_MS })
      else map.jumpTo(to)
      framed.current = true
    }
    // `fit` reads only refs and the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, fallbackCenter, ready])

  // 2D / 3D
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.easeTo({ pitch: mode === '3d' ? PITCH_3D : 0, bearing: mode === '3d' ? BEARING_3D : 0, duration: 700 })
  }, [mode, ready])

  // Route lines and site zone data
  useEffect(() => {
    if (!ready) return
    mapRef.current?.getSource<GeoJSONSource>(TRAIL_AHEAD_SOURCE)?.setData(trailFeature(path))
  }, [path, ready])

  useEffect(() => {
    if (!ready) return
    mapRef.current?.getSource<GeoJSONSource>(TRAIL_SOURCE)?.setData(trailFeature(driven))
  }, [driven, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.getSource<GeoJSONSource>(SITE_SOURCE)?.setData(siteFeatures(geofences))
    placeMarkers.current.forEach((m) => m.remove())
    placeMarkers.current = addPlaceMarkers(map, geofences)
  }, [geofences, ready])

  return <div ref={container} className={styles.map} />
}
