import { describe, expect, it } from 'vitest'
import { CAR_MODELS, MODEL_FRONT_OFFSET_DEG, modelFor, orientationFor } from './carModels'

describe('modelFor', () => {
  it('gives each car its own model and cycles when there are more cars than models', () => {
    expect(modelFor(0)).toBe(CAR_MODELS[0])
    expect(modelFor(1)).toBe(CAR_MODELS[1])
    expect(modelFor(2)).toBe(CAR_MODELS[0])
    expect(modelFor(-1)).toBe(CAR_MODELS[1])
  })
})

describe('orientationFor', () => {
  it('stands the model upright (roll 90) and yaws against the clockwise compass heading', () => {
    expect(orientationFor(0)).toEqual([0, MODEL_FRONT_OFFSET_DEG, 90])
    expect(orientationFor(90)).toEqual([0, MODEL_FRONT_OFFSET_DEG - 90, 90])
  })
  it('turns the nose half way round because the Kenney models face south after the roll', () => {
    expect(MODEL_FRONT_OFFSET_DEG).toBe(180)
  })
})
