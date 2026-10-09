// Thin fetch wrapper for the Traccar REST API. The session cookie (JSESSIONID) does the authentication, so every
// call carries credentials and nothing is stored by the app. A 401 on any call reports "signed out" once through
// `onUnauthorized` and still rejects, so the caller's own promise settles.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class TraccarHttpError extends Error {
  readonly status: number
  constructor(status: number, path: string) {
    super(`Traccar ${path} answered ${status}`)
    this.name = 'TraccarHttpError'
    this.status = status
  }
}

export type Query = Record<string, string | number | (string | number)[] | undefined>

/** "?deviceId=1&deviceId=2&from=..." (arrays repeat the key, as Traccar's report endpoints expect). */
export function queryString(query: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, String(v))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}

/** Traccar's date parameters are ISO 8601 UTC; whole seconds are enough. */
export function isoParam(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Credentials mode for the base URL: an absolute (other-origin) server needs "include", the same origin does not. */
export function credentialsFor(baseUrl: string): RequestCredentials {
  return baseUrl === '' ? 'same-origin' : 'include'
}

export interface Http {
  getJson<T>(path: string, query?: Query): Promise<T>
}

export function createHttp(opts: { baseUrl: string; fetch: FetchLike; onUnauthorized?: () => void }): Http {
  const { baseUrl, onUnauthorized } = opts
  return {
    async getJson<T>(path: string, query: Query = {}): Promise<T> {
      const response = await opts.fetch(`${baseUrl}${path}${queryString(query)}`, {
        headers: { Accept: 'application/json' },
        credentials: credentialsFor(baseUrl),
      })
      if (response.status === 401) {
        onUnauthorized?.()
        throw new TraccarHttpError(401, path)
      }
      if (!response.ok) throw new TraccarHttpError(response.status, path)
      return (await response.json()) as T
    },
  }
}
