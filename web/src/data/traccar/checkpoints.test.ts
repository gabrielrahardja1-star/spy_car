import { describe, expect, it } from 'vitest'
import { FakeSocket } from '../../test/fakeSocket'
import type { TraccarDevice, TraccarGeofence, TraccarUser } from './api'
import { createTraccarDataSource } from './dataSource'

interface Call {
  method: string
  path: string
  body: unknown
}

/** A tiny Traccar: geofences and users in memory, every request recorded. */
function server(opts: { me?: TraccarUser | null; users?: TraccarUser[]; refuse?: number } = {}) {
  const me = opts.me === undefined ? { id: 1, administrator: true } : opts.me
  const users = opts.users ?? [{ id: 1, administrator: true }, { id: 2 }, { id: 3, readonly: true }]
  let geofences: TraccarGeofence[] = [
    { id: 7, name: 'Area 2', area: 'POLYGON ((-3.17 115.28, -3.18 115.28, -3.18 115.29))' },
    { id: 8, name: 'CP1 Gate', area: 'CIRCLE (-3.172592 115.279189, 30)', attributes: { type: 'checkpoint', color: 'red' } },
  ]
  let devices: TraccarDevice[] = [
    { id: 1, name: 'DT-01', uniqueId: 'dt-01', model: 'teltonika', phone: '+62 812 1', attributes: { driver: 'Budi', speedLimit: 30 } },
    { id: 2, name: 'DT-02', uniqueId: 'dt-02', disabled: true, attributes: { source: 'simulator' } },
  ]
  const calls: Call[] = []
  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const fetch = async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const path = input.replace(/\?.*$/, '')
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    if (opts.refuse && method !== 'GET') return json(opts.refuse)
    if (path === '/api/session') return me ? json(200, me) : json(404)
    if (path === '/api/users') return json(200, users)
    if (path === '/api/geofences' && method === 'GET') return json(200, geofences)
    if (path === '/api/geofences' && method === 'POST') {
      const created = { ...(body as TraccarGeofence), id: 9 }
      geofences = [...geofences, created]
      return json(200, created)
    }
    const one = /^\/api\/geofences\/(\d+)$/.exec(path)
    if (one && method === 'PUT') {
      geofences = geofences.map((g) => (g.id === Number(one[1]) ? (body as TraccarGeofence) : g))
      return json(200, body)
    }
    if (one && method === 'DELETE') {
      geofences = geofences.filter((g) => g.id !== Number(one[1]))
      return json(204)
    }
    if (path === '/api/devices' && method === 'GET') return json(200, devices)
    if (path === '/api/devices' && method === 'POST') {
      const created = { ...(body as TraccarDevice), id: 3 }
      devices = [...devices, created]
      return json(200, created)
    }
    const device = /^\/api\/devices\/(\d+)$/.exec(path)
    if (device && method === 'PUT') {
      devices = devices.map((d) => (d.id === Number(device[1]) ? (body as TraccarDevice) : d))
      return json(200, body)
    }
    if (device && method === 'DELETE') {
      devices = devices.filter((d) => d.id !== Number(device[1]))
      return json(204)
    }
    if (path === '/api/permissions' && method === 'POST') return json(204)
    return json(404)
  }
  const source = createTraccarDataSource({ baseUrl: '', fetch, now: () => 0, WebSocketImpl: FakeSocket })
  return { source, calls, changes: () => calls.filter((c) => c.method !== 'GET') }
}

describe('checkpoint editing against Traccar', () => {
  it('lets only a signed-in administrator who is not read-only edit', async () => {
    expect(await server().source.checkpoints!.canEdit()).toBe(true)
    expect(await server({ me: { id: 1, administrator: true, readonly: true } }).source.checkpoints!.canEdit()).toBe(false)
    expect(await server({ me: { id: 2 } }).source.checkpoints!.canEdit()).toBe(false)
    expect(await server({ me: null }).source.checkpoints!.canEdit()).toBe(false)
  })

  it('creates a circle marked as a checkpoint and shares it with every other user', async () => {
    const { source, changes } = server()
    await source.checkpoints!.save({ name: ' CP2 South gate ', lat: -3.174385, lon: 115.281022, radiusM: 25 })
    expect(changes()).toEqual([
      {
        method: 'POST',
        path: '/api/geofences',
        body: { name: 'CP2 South gate', area: 'CIRCLE (-3.174385 115.281022, 25)', attributes: { type: 'checkpoint' } },
      },
      { method: 'POST', path: '/api/permissions', body: { userId: 2, geofenceId: 9 } },
      { method: 'POST', path: '/api/permissions', body: { userId: 3, geofenceId: 9 } },
    ])
  })

  it('updates in place, keeping the fields and attributes it does not edit', async () => {
    const { source, changes } = server()
    await source.getGeofences()
    await source.checkpoints!.save({ name: 'CP1 West gate', lat: -3.1726, lon: 115.2792, radiusM: 40 }, '8')
    expect(changes()).toEqual([
      {
        method: 'PUT',
        path: '/api/geofences/8',
        body: { id: 8, name: 'CP1 West gate', area: 'CIRCLE (-3.172600 115.279200, 40)', attributes: { type: 'checkpoint', color: 'red' } },
      },
    ])
  })

  it('deletes, then lists the geofences afresh and tells listeners', async () => {
    const { source } = server()
    expect((await source.getGeofences()).map((g) => [g.name, g.kind, g.circle?.radiusM])).toEqual([
      ['Area 2', 'site', undefined],
      ['CP1 Gate', 'checkpoint', 30],
    ])
    let told = 0
    source.onGeofencesChange!(() => told++)
    await source.checkpoints!.remove('8')
    expect(told).toBe(1)
    expect((await source.getGeofences()).map((g) => g.name)).toEqual(['Area 2'])
  })

  it('passes on a refusal from the server and changes nothing', async () => {
    const { source } = server({ refuse: 403 })
    await expect(source.checkpoints!.remove('8')).rejects.toMatchObject({ status: 403 })
    expect((await source.getGeofences()).map((g) => g.name)).toEqual(['Area 2', 'CP1 Gate'])
  })
})

describe('truck management against Traccar', () => {
  it('lists every truck, disabled ones too, while the app shows only enabled ones', async () => {
    const { source } = server()
    expect(await source.trucks!.list()).toEqual([
      { id: '1', name: 'DT-01', source: 'tracker', trackerId: 'dt-01', model: 'teltonika', phone: '+62 812 1', driver: 'Budi', enabled: true },
      { id: '2', name: 'DT-02', source: 'simulator', trackerId: 'dt-02', model: '', phone: '', driver: '', enabled: false },
    ])
    expect((await source.getCars()).map((c) => c.name)).toEqual(['DT-01'])
  })

  it('adds a truck, shares it with every other user and shows it at once', async () => {
    const { source, changes } = server()
    await source.getCars()
    let told = 0
    source.onCarsChange!(() => told++)
    await source.trucks!.save({ name: ' DT-03 ', source: 'tracker', trackerId: ' 490154203237518 ', model: 'gt06', phone: ' +62 812 3 ', driver: '' })
    expect(changes()).toEqual([
      {
        method: 'POST',
        path: '/api/devices',
        body: { name: 'DT-03', uniqueId: '490154203237518', model: 'gt06', phone: '+62 812 3', category: 'truck', attributes: { source: 'tracker' } },
      },
      { method: 'POST', path: '/api/permissions', body: { userId: 2, deviceId: 3 } },
      { method: 'POST', path: '/api/permissions', body: { userId: 3, deviceId: 3 } },
    ])
    expect(told).toBe(1)
    expect((await source.getCars()).map((c) => c.name)).toEqual(['DT-01', 'DT-03'])
  })

  it('refuses a tracker ID another truck already has, before asking the server', async () => {
    const { source, changes } = server()
    await expect(source.trucks!.save({ name: 'DT-03', source: 'simulator', trackerId: 'DT-02', model: '', phone: '', driver: '' })).rejects.toThrow(
      'Tracker ID DT-02 is already used by DT-02.',
    )
    expect(changes()).toEqual([])
  })

  it('edits in place, keeping other attributes; an empty driver removes the label; a test truck drops model and SIM', async () => {
    const { source, changes } = server()
    await source.trucks!.save({ name: 'DT-01', source: 'simulator', trackerId: 'sim-dt-01', model: 'teltonika', phone: '+62 812 1', driver: '' }, '1')
    expect(changes()).toEqual([
      {
        method: 'PUT',
        path: '/api/devices/1',
        body: {
          id: 1,
          name: 'DT-01',
          uniqueId: 'sim-dt-01',
          model: null,
          phone: null,
          category: 'truck',
          attributes: { speedLimit: 30, source: 'simulator' },
        },
      },
    ])
    expect((await source.getCars())[0]).toMatchObject({ name: 'DT-01', test: true })
  })

  it('disables and enables without losing anything, and deletes on request', async () => {
    const { source, changes } = server()
    await source.trucks!.setEnabled('1', false)
    await source.trucks!.setEnabled('2', true)
    await source.trucks!.remove('1')
    expect(changes().map((c) => [c.method, c.path, (c.body as TraccarDevice | undefined)?.disabled])).toEqual([
      ['PUT', '/api/devices/1', true],
      ['PUT', '/api/devices/2', false],
      ['DELETE', '/api/devices/1', undefined],
    ])
    expect((await source.getCars()).map((c) => c.name)).toEqual(['DT-02'])
  })
})
