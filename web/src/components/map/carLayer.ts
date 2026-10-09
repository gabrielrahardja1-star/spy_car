// 3D car models drawn with deck.gl on top of the MapLibre map. Loaded on demand by LiveMapView so a failure
// (no WebGL2, model missing) leaves the pins working with a flat marker.
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScenegraphLayer } from '@deck.gl/mesh-layers'
import { MODEL_METRES_PER_UNIT, MODEL_MIN_PIXELS, orientationFor } from './carModels'
import type { LngLat } from './mapGeometry'

export interface CarDraw {
  id: string
  model: string
  position: LngLat
  /** Degrees clockwise from north. */
  heading: number
}

export interface CarOverlay {
  overlay: MapboxOverlay
  /** Replace the drawn cars. Call every animation frame while any car is moving. */
  setCars(cars: CarDraw[]): void
}

export function createCarOverlay(onModelError: (error: Error) => void): CarOverlay {
  // Interleaved: the cars share the map's depth buffer, so buildings can hide them like real objects.
  const overlay = new MapboxOverlay({ interleaved: true, layers: [], onError: (e) => onModelError(e) })
  return {
    overlay,
    setCars(cars) {
      const models = [...new Set(cars.map((c) => c.model))]
      overlay.setProps({
        layers: models.map(
          (model) =>
            new ScenegraphLayer<CarDraw>({
              id: `cars-${model}`,
              data: cars.filter((c) => c.model === model),
              scenegraph: model,
              getPosition: (c) => [c.position[0], c.position[1], 0],
              getOrientation: (c) => orientationFor(c.heading),
              sizeScale: MODEL_METRES_PER_UNIT,
              sizeMinPixels: MODEL_MIN_PIXELS,
              _lighting: 'pbr',
              onError: (e: Error) => onModelError(e),
            }),
        ),
      })
    },
  }
}
