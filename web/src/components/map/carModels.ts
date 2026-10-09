// Which 3D model each car uses. Models live in public/models (Kenney Car Kit, CC0; see public/models/README.md).
const base = import.meta.env.BASE_URL

/** Red sedan matches Car 01's red tile; the dark SUV matches Car 02's dark tile. */
export const CAR_MODELS = [`${base}models/sedan.glb`, `${base}models/suv.glb`]

/** Model for the car at `index` in the car list (cycles if there are more cars than models). */
export function modelFor(index: number): string {
  return CAR_MODELS[((index % CAR_MODELS.length) + CAR_MODELS.length) % CAR_MODELS.length]
}

/** The Kenney models are about 2 scene units long; 1 unit is roughly 2 m for a real car. */
export const MODEL_METRES_PER_UNIT = 2.2
/**
 * Cars stay this many pixels per scene unit at least, so they are visible at any zoom
 * (at city zoom a real 4 m car would be under one pixel).
 */
export const MODEL_MIN_PIXELS = 24

/**
 * Turns a compass heading into deck.gl's [pitch, yaw, roll]. The Kenney models face +Z with Y up, so roll 90
 * stands them upright in deck's Z-up space; yaw then spins them about the vertical.
 */
export function orientationFor(heading: number): [number, number, number] {
  return [0, -heading + MODEL_FRONT_OFFSET_DEG, 90]
}

/**
 * Spin that makes a model's nose point along its heading. The Kenney models' +Z nose lands on south after the
 * upright roll, so they need a half turn (checked top-down: the SUV's spare wheel, at its rear, trails the course).
 */
export const MODEL_FRONT_OFFSET_DEG = 180
