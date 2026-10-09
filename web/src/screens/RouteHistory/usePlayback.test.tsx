import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Position, Trip } from '../../data/types'
import { CAR_1, position, trip } from '../../test/fakeSource'
import { BASE_RATE, usePlayback } from './usePlayback'

const T0 = Date.UTC(2026, 9, 8, 0, 0)
const MIN = 60_000

// A manual requestAnimationFrame: nothing runs until the test delivers a frame.
let pending = new Map<number, FrameRequestCallback>()
let nextId = 1
beforeEach(() => {
  pending = new Map()
  nextId = 1
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending.set(nextId, cb)
    return nextId++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Delivers one animation frame stamped `ts` (ms) to everything waiting for one. */
function frame(ts: number) {
  const callbacks = [...pending.values()]
  pending.clear()
  act(() => callbacks.forEach((cb) => cb(ts)))
}

const shortTrip = trip(CAR_1.id, T0, T0 + 10 * MIN)
const route: Position[] = [position(CAR_1.id, T0), position(CAR_1.id, T0 + 10 * MIN)]

describe('usePlayback', () => {
  it('starts paused at the beginning, and never plays by itself', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    expect(result.current).toMatchObject({ playing: false, time: T0, fraction: 0, speed: 1, enabled: true })
    expect(result.current.span).toEqual({ start: T0, end: T0 + 10 * MIN })
    expect(pending.size).toBe(0)
  })

  it('advances 60 trip-seconds per real second at 1x', () => {
    expect(BASE_RATE).toBe(60)
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.play())
    expect(result.current.playing).toBe(true)
    frame(1000) // first frame only sets the reference time
    expect(result.current.time).toBe(T0)
    frame(1100)
    expect(result.current.time).toBe(T0 + 6000) // 100 ms real = 6 s of trip
    frame(1200)
    expect(result.current.time).toBe(T0 + 12_000)
  })

  it('goes faster at higher speeds and cycles 1x, 2x, 4x, 8x, then 1x again', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    expect(result.current.speed).toBe(1)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(2)
    act(() => result.current.cycleSpeed())
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(8)
    act(() => result.current.cycleSpeed())
    expect(result.current.speed).toBe(1)

    act(() => result.current.cycleSpeed())
    act(() => result.current.cycleSpeed()) // 4x
    act(() => result.current.play())
    frame(0)
    frame(100)
    expect(result.current.time).toBe(T0 + 100 * 4 * BASE_RATE)
  })

  it('changing speed while playing keeps playing from where it was', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.play())
    frame(0)
    frame(100)
    act(() => result.current.cycleSpeed())
    expect(result.current.playing).toBe(true)
    frame(200)
    expect(result.current.time).toBe(T0 + 6000 + 100 * 2 * BASE_RATE)
    frame(300)
    expect(result.current.time).toBe(T0 + 6000 + 2 * 100 * 2 * BASE_RATE)
  })

  it('stops at the end, pauses, and asks for no more frames', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.play())
    for (let ts = 0; ts < 20_000 && result.current.playing; ts += 100) frame(ts)
    expect(result.current).toMatchObject({ playing: false, time: T0 + 10 * MIN, fraction: 1 })
    expect(pending.size).toBe(0)
  })

  it('plays from the start again when played at the end', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.seek(T0 + 10 * MIN))
    expect(result.current.fraction).toBe(1)
    act(() => result.current.play())
    expect(result.current).toMatchObject({ playing: true, fraction: 0, time: T0 })
  })

  it('treats a long stalled frame as a short one', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.play())
    frame(0)
    frame(60_000) // tab was hidden for a minute
    expect(result.current.time).toBe(T0 + 250 * BASE_RATE)
  })

  it('seeks, clamped to the trip, and keeps playing if it was playing', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.seek(T0 + 5 * MIN))
    expect(result.current).toMatchObject({ time: T0 + 5 * MIN, fraction: 0.5, playing: false })
    act(() => result.current.seek(T0 - 99 * MIN))
    expect(result.current.time).toBe(T0)
    act(() => result.current.seek(T0 + 99 * MIN))
    expect(result.current.time).toBe(T0 + 10 * MIN)

    act(() => result.current.seek(T0 + MIN))
    act(() => result.current.play())
    act(() => result.current.seek(T0 + 2 * MIN))
    expect(result.current).toMatchObject({ playing: true, time: T0 + 2 * MIN })
  })

  it('toggles between playing and paused', () => {
    const { result } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.playing).toBe(false)
  })

  it('goes back to the start, paused, when the trip changes, and keeps the chosen speed', () => {
    const other: Trip = trip(CAR_1.id, T0 + 60 * MIN, T0 + 80 * MIN)
    const otherRoute: Position[] = [position(CAR_1.id, other.startTime), position(CAR_1.id, other.endTime ?? 0)]
    const { result, rerender } = renderHook(({ t, r }) => usePlayback(t, r), { initialProps: { t: shortTrip as Trip | null, r: route } })
    act(() => result.current.cycleSpeed())
    act(() => result.current.play())
    frame(0)
    frame(100)
    expect(result.current.time).toBeGreaterThan(T0)

    rerender({ t: other, r: otherRoute })
    expect(result.current).toMatchObject({ playing: false, time: other.startTime, fraction: 0, speed: 2 })
    expect(pending.size).toBe(0)

    // The old trip is a different trip again, so it also starts over.
    act(() => result.current.seek(other.startTime + 5 * MIN))
    rerender({ t: shortTrip, r: route })
    expect(result.current.time).toBe(T0)
  })

  it('does not reset when the same trip is refreshed with new data', () => {
    const { result, rerender } = renderHook(({ t }) => usePlayback(t, route), { initialProps: { t: shortTrip } })
    act(() => result.current.seek(T0 + 3 * MIN))
    rerender({ t: { ...shortTrip, distanceM: 12_345 } })
    expect(result.current.time).toBe(T0 + 3 * MIN)
  })

  it('has nothing to play without a trip or without route points', () => {
    const none = renderHook(() => usePlayback(null, route))
    expect(none.result.current).toMatchObject({ time: null, span: null, enabled: false, fraction: 0 })
    act(() => none.result.current.play())
    expect(none.result.current.playing).toBe(false)

    const empty = renderHook(() => usePlayback(shortTrip, []))
    expect(empty.result.current.enabled).toBe(false)
    expect(empty.result.current.time).toBe(T0)
    act(() => empty.result.current.play())
    expect(empty.result.current.playing).toBe(false)
    expect(pending.size).toBe(0)
  })

  it('replays a trip still under way up to its newest fix', () => {
    const open = trip(CAR_1.id, T0, null)
    const fixes = [position(CAR_1.id, T0), position(CAR_1.id, T0 + 4 * MIN)]
    const { result } = renderHook(() => usePlayback(open, fixes))
    expect(result.current.span).toEqual({ start: T0, end: T0 + 4 * MIN })
    act(() => result.current.play())
    for (let ts = 0; ts < 10_000 && result.current.playing; ts += 100) frame(ts)
    expect(result.current).toMatchObject({ playing: false, time: T0 + 4 * MIN })
  })

  it('cancels its animation frame on unmount', () => {
    const { result, unmount } = renderHook(() => usePlayback(shortTrip, route))
    act(() => result.current.play())
    expect(pending.size).toBe(1)
    unmount()
    expect(pending.size).toBe(0)
  })
})
