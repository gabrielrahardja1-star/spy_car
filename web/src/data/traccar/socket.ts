// The live WebSocket (/api/socket, session cookie only) with reconnect and back-off.
// Server behaviour (AsyncSocket.java): on open it sends the latest positions, then one JSON object per change with
// optional `positions` / `devices` / `events` keys, and `{}` as keep-alive. A refused upgrade (no session) is
// indistinguishable from a network failure in the browser, so a failed connect asks `probeSession` before retrying.
import type { ConnectionState } from '../source'
import type { SessionCheck } from './auth'

export const RECONNECT_BASE_MS = 1000
export const RECONNECT_MAX_MS = 30_000
/** A connection that stayed open this long counts as healthy: the back-off starts over at 1 s. */
export const STABLE_AFTER_MS = 10_000
/** Consecutive failed connects before the state changes from 'reconnecting' to 'offline'. */
export const OFFLINE_AFTER_FAILURES = 3

/** The slice of the browser WebSocket this code uses, so tests can pass a fake. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  close(): void
}
export type SocketCtor = new (url: string) => SocketLike

export interface LiveSocketOptions {
  url: string
  WebSocketImpl: SocketCtor
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  random: () => number
  now: () => number
  /** Every message that arrives, parsed (null if it was not JSON). */
  onMessage: (data: unknown, receivedAt: number) => void
  onState: (state: ConnectionState) => void
  /** Asked after a connect that never opened. 'invalid' stops the retries and calls `onAuthRequired`. */
  probeSession?: () => Promise<SessionCheck>
  onAuthRequired?: () => void
}

/** Delay before reconnect attempt number `attempt` (0 = first retry): 1 s, 2 s, 4 s ... capped at 30 s, plus up to 1 s of jitter. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempt, 10))
  return base + Math.floor(random() * 1000)
}

export function createLiveSocket(opts: LiveSocketOptions): { start(): void; stop(): void } {
  let stopped = true
  let socket: SocketLike | null = null
  let retryTimer: unknown = null
  let stableTimer: unknown = null
  let attempt = 0
  let failures = 0
  let state: ConnectionState | null = null

  const setState = (next: ConnectionState) => {
    if (next === state) return
    state = next
    opts.onState(next)
  }

  const clearTimers = () => {
    if (retryTimer !== null) opts.clearTimer(retryTimer)
    if (stableTimer !== null) opts.clearTimer(stableTimer)
    retryTimer = null
    stableTimer = null
  }

  const connect = () => {
    retryTimer = null
    let opened = false
    const ws = new opts.WebSocketImpl(opts.url)
    socket = ws

    ws.onopen = () => {
      if (socket !== ws) return
      opened = true
      failures = 0
      setState('connected')
      stableTimer = opts.setTimer(() => {
        attempt = 0
        stableTimer = null
      }, STABLE_AFTER_MS)
    }

    ws.onmessage = (ev) => {
      if (socket !== ws) return
      let data: unknown = null
      if (typeof ev.data === 'string') {
        try {
          data = JSON.parse(ev.data)
        } catch {
          data = null
        }
      }
      opts.onMessage(data, opts.now())
    }

    // Browsers fire error and then close; closing is handled once, in onclose.
    ws.onerror = () => {}
    ws.onclose = () => {
      if (socket !== ws) return
      socket = null
      if (stableTimer !== null) opts.clearTimer(stableTimer)
      stableTimer = null
      if (stopped) return
      if (!opened) failures++
      setState(failures >= OFFLINE_AFTER_FAILURES ? 'offline' : 'reconnecting')
      retryTimer = opts.setTimer(connect, backoffMs(attempt++, opts.random))
      if (!opened && opts.probeSession) {
        void opts.probeSession().then((check) => {
          if (check !== 'invalid' || stopped) return
          stop()
          opts.onAuthRequired?.()
        })
      }
    }
  }

  const stop = () => {
    stopped = true
    clearTimers()
    const ws = socket
    socket = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
      ws.close()
    }
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      attempt = 0
      failures = 0
      setState('reconnecting')
      connect()
    },
    stop,
  }
}
