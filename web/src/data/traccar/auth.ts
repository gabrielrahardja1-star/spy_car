// Login, session check and logout against Traccar's /api/session (spec 6.x):
//   POST   form-urlencoded email + password -> 200 User and a JSESSIONID cookie; 401 on wrong credentials
//   GET    200 User when the cookie is valid; 404 (not 401!) when there is no session
//   DELETE 204
// The cookie is HttpOnly and lives in the browser. The app never sees, keeps or stores the password or any token.
import { credentialsFor, type FetchLike } from './http'

export type LoginResult = { ok: true } | { ok: false; reason: 'invalid' | 'unreachable' }
export type SessionCheck = 'valid' | 'invalid' | 'unreachable'

export interface TraccarAuth {
  login(email: string, password: string): Promise<LoginResult>
  checkSession(): Promise<SessionCheck>
  logout(): Promise<void>
}

export function createTraccarAuth(opts: { baseUrl: string; fetch: FetchLike }): TraccarAuth {
  const url = `${opts.baseUrl}/api/session`
  const credentials = credentialsFor(opts.baseUrl)

  return {
    async login(email, password) {
      try {
        const response = await opts.fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ email, password }).toString(),
          credentials,
        })
        if (response.ok) return { ok: true }
        // 401 = wrong credentials; 403 = account disabled or expired. Anything else is the server, not the user.
        return { ok: false, reason: response.status === 401 || response.status === 403 ? 'invalid' : 'unreachable' }
      } catch {
        return { ok: false, reason: 'unreachable' }
      }
    },

    async checkSession() {
      try {
        const response = await opts.fetch(url, { headers: { Accept: 'application/json' }, credentials })
        if (response.ok) return 'valid'
        return response.status === 401 || response.status === 404 ? 'invalid' : 'unreachable'
      } catch {
        return 'unreachable'
      }
    },

    async logout() {
      try {
        await opts.fetch(url, { method: 'DELETE', credentials })
      } catch {
        // Nothing to do: the screen returns to the login form either way, and the cookie expires on its own.
      }
    },
  }
}
