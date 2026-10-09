import { describe, expect, it, vi } from 'vitest'
import { createTraccarAuth } from './auth'
import { createHttp, isoParam, queryString, TraccarHttpError } from './http'

const reply = (status: number, body?: unknown) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

describe('createTraccarAuth', () => {
  it('posts the credentials form-encoded to /api/session and reports success', async () => {
    const fetch = vi.fn(reply(200, { id: 1 }))
    const auth = createTraccarAuth({ baseUrl: '', fetch })
    expect(await auth.login('a@b.c', 'p&w =1')).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/session')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(init.body as string)
    expect(form.get('email')).toBe('a@b.c')
    expect(form.get('password')).toBe('p&w =1')
    expect(init.credentials).toBe('same-origin')
  })

  it('uses the configured server and sends the cookie to it', async () => {
    const fetch = vi.fn(reply(200, {}))
    await createTraccarAuth({ baseUrl: 'https://t.example.com', fetch }).login('a', 'b')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://t.example.com/api/session')
    expect(init.credentials).toBe('include')
  })

  it('maps 401 to a wrong login, a dead network and server errors to unreachable', async () => {
    expect(await createTraccarAuth({ baseUrl: '', fetch: reply(401) }).login('a', 'b')).toEqual({ ok: false, reason: 'invalid' })
    expect(await createTraccarAuth({ baseUrl: '', fetch: reply(403) }).login('a', 'b')).toEqual({ ok: false, reason: 'invalid' })
    expect(await createTraccarAuth({ baseUrl: '', fetch: reply(502) }).login('a', 'b')).toEqual({ ok: false, reason: 'unreachable' })
    const down = async () => {
      throw new TypeError('Failed to fetch')
    }
    expect(await createTraccarAuth({ baseUrl: '', fetch: down }).login('a', 'b')).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('checkSession: 200 valid; 404 and 401 invalid (Traccar answers 404 without a session); others unreachable', async () => {
    const check = (f: () => Promise<Response>) => createTraccarAuth({ baseUrl: '', fetch: f }).checkSession()
    expect(await check(reply(200, {}))).toBe('valid')
    expect(await check(reply(404))).toBe('invalid')
    expect(await check(reply(401))).toBe('invalid')
    expect(await check(reply(500))).toBe('unreachable')
    expect(
      await check(async () => {
        throw new TypeError('x')
      }),
    ).toBe('unreachable')
  })

  it('logout sends DELETE and never throws', async () => {
    const fetch = vi.fn(reply(204))
    await createTraccarAuth({ baseUrl: '', fetch }).logout()
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE')
    await expect(
      createTraccarAuth({
        baseUrl: '',
        fetch: async () => {
          throw new TypeError('x')
        },
      }).logout(),
    ).resolves.toBeUndefined()
  })
})

describe('http', () => {
  it('repeats array parameters and skips undefined ones', () => {
    expect(queryString({ deviceId: [1, 2], from: 'a b', x: undefined })).toBe('?deviceId=1&deviceId=2&from=a+b')
    expect(queryString({})).toBe('')
  })

  it('formats dates as ISO 8601 UTC without milliseconds', () => {
    expect(isoParam(Date.UTC(2026, 9, 8, 6, 0, 0, 123))).toBe('2026-10-08T06:00:00Z')
  })

  it('reports a 401 once through onUnauthorized and still rejects', async () => {
    const onUnauthorized = vi.fn()
    const http = createHttp({ baseUrl: '', fetch: reply(401), onUnauthorized })
    await expect(http.getJson('/api/devices')).rejects.toBeInstanceOf(TraccarHttpError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('rejects other errors without signalling sign-out, and lets network errors through', async () => {
    const onUnauthorized = vi.fn()
    const http = createHttp({ baseUrl: '', fetch: reply(500), onUnauthorized })
    await expect(http.getJson('/api/devices')).rejects.toMatchObject({ status: 500 })
    const down = createHttp({
      baseUrl: '',
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      onUnauthorized,
    })
    await expect(down.getJson('/x')).rejects.toBeInstanceOf(TypeError)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('asks for JSON', async () => {
    const fetch = vi.fn(reply(200, []))
    await createHttp({ baseUrl: '', fetch }).getJson('/api/devices', { id: 1 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/devices?id=1')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })
})
