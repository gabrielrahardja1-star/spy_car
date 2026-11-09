import { describe, expect, it } from 'vitest'
import { isValidImei, simulatorId, trackerModel } from './trackers'

describe('trackers', () => {
  it('accepts a real IMEI and refuses a wrong check digit, length or letters', () => {
    expect(isValidImei('490154203237518')).toBe(true)
    expect(isValidImei('490154203237517')).toBe(false)
    expect(isValidImei('49015420323751')).toBe(false)
    expect(isValidImei('49015420323751X')).toBe(false)
  })

  it('makes a simulator ID from the name', () => {
    expect(simulatorId(' DT-03 ')).toBe('sim-dt-03')
    expect(simulatorId('Truck 7 (spare)')).toBe('sim-truck-7-spare')
    expect(simulatorId('')).toBe('sim-truck')
  })

  it('knows the port of each tracker family the server listens for', () => {
    expect(trackerModel('teltonika')).toMatchObject({ port: 5027, bindVar: 'TELTONIKA_BIND' })
    expect(trackerModel('nope')).toBeUndefined()
  })
})
