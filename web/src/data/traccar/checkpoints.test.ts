import { describe, expect, it } from 'vitest'
import { FakeSocket } from '../../test/fakeSocket'
import type { TraccarGeofence, TraccarUser } from './api'
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
