import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState } from '../source'
import type { SessionCheck } from './auth'
import { FakeSocket } from '../../test/fakeSocket'
import { backoffMs, createLiveSocket, OFFLINE_AFTER_FAILURES, RECONNECT_MAX_MS, STABLE_AFTER_MS } from './socket'

const last = () => FakeSocket.last()

function setup(over: { probe?: () => Promise<SessionCheck>; onAuthRequired?: () => void } = {}) {
  const states: ConnectionState[] = []
  const messages: { data: unknown; at: number }[] = []
  const socket = createLiveSocket({
    url: 'ws://x/api/socket',
    WebSocketImpl: FakeSocket,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random: () => 0,
    now: () => Date.now(),
    onMessage: (data, at) => messages.push({ data, at }),
    onState: (s) => states.push(s),
    probeSession: over.probe,
    onAuthRequired: over.onAuthRequired,
  })
  return { socket, states, messages }
}

beforeEach(() => {
  FakeSocket.all = []
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('backoffMs', () => {
  it('doubles from 1 s up to the 30 s cap, plus jitter below 1 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((a) => backoffMs(a, () => 0))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
    expect(backoffMs(0, () => 0.999)).toBe(1999)
    expect(backoffMs(9, () => 0.5)).toBe(RECONNECT_MAX_MS + 500)
  })
})

describe('createLiveSocket', () => {
  it('connects, reports state, and hands over every message with its arrival time', () => {
    const { socket, states, messages } = setup()
    socket.start()
    expect(FakeSocket.all).toHaveLength(1)
    expect(last().url).toBe('ws://x/api/socket')
    expect(states).toEqual(['reconnecting'])
    last().open()
    expect(states).toEqual(['reconnecting', 'connected'])

    vi.setSystemTime(5000)
    last().send({ positions: [] })
    last().send('{}')
    last().send('not json')
    expect(messages.map((m) => m.data)).toEqual([{ positions: [] }, {}, null])
    expect(messages[0].at).toBe(5000)
  })

  it('reconnects with a doubling delay while connects keep failing, and goes offline after repeated failures', () => {
    const { socket, states } = setup()
    socket.start()
    last().drop() // failure 1 -> retry in 1 s
    expect(states.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(999)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)

    last().drop() // failure 2 -> 2 s
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)

    last().drop() // failure 3 -> offline, 4 s
    expect(OFFLINE_AFTER_FAILURES).toBe(3)
    expect(states.at(-1)).toBe('offline')
    vi.advanceTimersByTime(4000)
    expect(FakeSocket.all).toHaveLength(4)
  })

  it('caps the delay at 30 s', () => {
    const { socket } = setup()
    socket.start()
    for (let i = 0; i < 10; i++) {
      last().drop()
      vi.advanceTimersByTime(RECONNECT_MAX_MS)
    }
    const before = FakeSocket.all.length
    last().drop()
    vi.advanceTimersByTime(RECONNECT_MAX_MS - 1)
    expect(FakeSocket.all).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(before + 1)
  })

  it('comes back to connected after an outage and starts the back-off over once the link was stable', () => {
    const { socket, states } = setup()
    socket.start()
    last().drop()
    vi.advanceTimersByTime(1000)
    last().drop()
    vi.advanceTimersByTime(2000)
    last().open()
    expect(states.at(-1)).toBe('connected')
    vi.advanceTimersByTime(STABLE_AFTER_MS)
    last().drop() // stable connection lost: first retry again takes 1 s
    expect(states.at(-1)).toBe('reconnecting')
    const n = FakeSocket.all.length
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(n + 1)
  })

  it('keeps backing off when a connection opens but dies at once', () => {
    const { socket } = setup()
    socket.start()
    last().open()
    last().drop() // not stable: next delay is 1 s, then it grows
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
    last().open()
    last().drop()
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
  })

  it('stop() closes the socket, cancels the retry and ignores late events', () => {
    const { socket, states, messages } = setup()
    socket.start()
    const ws = last()
    ws.open()
    socket.stop()
    expect(ws.closed).toBe(true)
    ws.send({ positions: [] })
    ws.drop()
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(messages).toEqual([])
    expect(states).toEqual(['reconnecting', 'connected'])

    const s2 = setup()
    s2.socket.start()
    last().drop()
    s2.socket.stop()
    vi.advanceTimersByTime(120_000)
    expect(FakeSocket.all).toHaveLength(2) // only the second setup's first connect
  })

  it('asks whether the session is still valid when a connect never opened, and stops with an auth signal if not', async () => {
    const onAuthRequired = vi.fn()
    const probe = vi.fn(async (): Promise<SessionCheck> => 'invalid')
    const { socket } = setup({ probe, onAuthRequired })
    socket.start()
    last().drop()
    await vi.advanceTimersByTimeAsync(0)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(onAuthRequired).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1) // no more retries
  })

  it('keeps retrying when the probe says the session is fine or the server is unreachable', async () => {
    const onAuthRequired = vi.fn()
    const answers: SessionCheck[] = ['valid', 'unreachable']
    const { socket } = setup({ probe: async () => answers.shift() ?? 'valid', onAuthRequired })
    socket.start()
    last().drop()
    await vi.advanceTimersByTimeAsync(1000)
    last().drop()
    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeSocket.all).toHaveLength(3)
    expect(onAuthRequired).not.toHaveBeenCalled()
  })

  it('does not probe when an established connection drops', async () => {
    const probe = vi.fn(async (): Promise<SessionCheck> => 'invalid')
    const { socket } = setup({ probe })
    socket.start()
    last().open()
    last().drop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(probe).not.toHaveBeenCalled()
    expect(FakeSocket.all).toHaveLength(2)
  })
})
