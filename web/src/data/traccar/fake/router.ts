// Traccar's REST endpoints (the ones this app uses) over a FakeBackend, as a plain request -> response function.
// The fake HTTP server (web/dev/fake-traccar.mjs) and the test fetch both sit on top of it.
// Faithful details: POST /api/session takes a form body and sets a JSESSIONID cookie (401 on bad credentials);
// GET /api/session answers 404 (not 401) without a session; every other endpoint answers 401 without one.
import type { FakeBackend } from './backend'

/** The one account the fake knows. Documented in web/dev/fake-traccar.mjs and .env.example. */
export const DEMO_EMAIL = 'demo@example.com'
export const DEMO_PASSWORD = 'demo'

export interface FakeRequest {
  method: string
  /** Path and query, e.g. "/api/reports/trips?deviceId=1&from=...". */
  url: string
  /** Raw Cookie header, if any. */
  cookie?: string
  body?: string
}

export interface FakeResponse {
  status: number
  json?: unknown
  setCookie?: string
}

export interface FakeRouter {
  handle(req: FakeRequest): Promise<FakeResponse>
  hasSession(cookie: string | undefined): boolean
  /** Forget every session (a test of "the session expired"). */
  expireSessions(): void
}

const COOKIE = 'JSESSIONID'

function sessionId(cookie: string | undefined): string | null {
  const match = cookie ? new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie) : null
  return match ? match[1] : null
}

export function createFakeRouter(backend: FakeBackend, random: () => string = () => Math.random().toString(36).slice(2)): FakeRouter {
  const sessions = new Set<string>()
  const hasSession = (cookie: string | undefined) => {
    const id = sessionId(cookie)
    return id !== null && sessions.has(id)
  }

  return {
    hasSession,
    expireSessions: () => sessions.clear(),

    async handle(req) {
      const url = new URL(req.url, 'http://fake.invalid')
      const path = url.pathname
      const q = url.searchParams
      const ids = q.getAll('deviceId').map(Number)
      const range = (): [number, number] => [Date.parse(q.get('from') ?? ''), Date.parse(q.get('to') ?? '')]

      if (path === '/api/session') {
        if (req.method === 'POST') {
          const form = new URLSearchParams(req.body ?? '')
          if (form.get('email') !== DEMO_EMAIL || form.get('password') !== DEMO_PASSWORD) return { status: 401 }
          const id = random()
          sessions.add(id)
          return { status: 200, json: { id: 1, name: 'Demo', email: DEMO_EMAIL }, setCookie: `${COOKIE}=${id}; Path=/; HttpOnly` }
        }
        if (req.method === 'DELETE') {
          const id = sessionId(req.cookie)
          if (id) sessions.delete(id)
          return { status: 204 }
        }
        return hasSession(req.cookie) ? { status: 200, json: { id: 1, name: 'Demo', email: DEMO_EMAIL } } : { status: 404 }
      }

      if (!hasSession(req.cookie)) return { status: 401 }
      if (req.method !== 'GET') return { status: 405 }

      switch (path) {
        case '/api/devices':
          return { status: 200, json: backend.devices() }
        case '/api/geofences':
          return { status: 200, json: backend.geofences() }
        case '/api/positions': {
          if (ids.length > 0) {
            const [from, to] = range()
            return { status: 200, json: await backend.route(ids, from, to) }
          }
          return { status: 200, json: await backend.latestPositions() }
        }
      }

      const [from, to] = range()
      if (path.startsWith('/api/reports/') && (ids.length === 0 || !Number.isFinite(from) || !Number.isFinite(to))) return { status: 400 }
      switch (path) {
        case '/api/reports/route':
          return { status: 200, json: await backend.route(ids, from, to) }
        case '/api/reports/trips':
          return { status: 200, json: await backend.trips(ids, from, to) }
        case '/api/reports/stops':
          return { status: 200, json: await backend.stops(ids, from, to) }
        case '/api/reports/summary': {
          const trips = await backend.trips(ids, from, to)
          return {
            status: 200,
            json: ids.map((deviceId) => {
              const mine = trips.filter((t) => t.deviceId === deviceId)
              return {
                deviceId,
                distance: mine.reduce((s, t) => s + (t.distance ?? 0), 0),
                maxSpeed: Math.max(0, ...mine.map((t) => t.maxSpeed ?? 0)),
                engineHours: 0,
              }
            }),
          }
        }
        default:
          return { status: 404 }
      }
    },
  }
}

/**
 * A fetch() that talks to the router in-process, keeping a cookie jar like a browser would.
 * `down` makes every request fail like a dead network.
 */
export function createFakeFetch(router: FakeRouter) {
  let cookie: string | undefined
  const state = { down: false }
  const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
    if (state.down) throw new TypeError('Failed to fetch')
    const response = await router.handle({
      method: init.method ?? 'GET',
      url: input,
      cookie,
      body: typeof init.body === 'string' ? init.body : undefined,
    })
    if (response.setCookie) cookie = response.setCookie.split(';')[0]
    if (input.includes('/api/session') && init.method === 'DELETE') cookie = undefined
    const hasBody = response.json !== undefined
    return new Response(hasBody ? JSON.stringify(response.json) : null, {
      status: response.status,
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    })
  }
  return Object.assign(fetchImpl, {
    state,
    cookie: () => cookie,
    /** Pretend the browser lost the cookie. */
    dropCookie: () => {
      cookie = undefined
    },
  })
}
