import { useCallback, useEffect, useMemo, useState } from 'react'
import { tripSpan, type TimeSpan } from '../../components/map/playback'
import type { Position, Trip } from '../../data/types'

export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/**
 * Trip time that passes per unit of real time at 1x: 60 trip-seconds per real second, so a typical one-hour trip
 * replays in about a minute (8x: under eight seconds). Chosen so a full day's trips can be watched in a few minutes.
 */
export const BASE_RATE = 60

/** A frame longer than this (tab was hidden, machine stalled) only advances the replay by this much. */
const MAX_FRAME_MS = 250

interface State {
  /** The trip this state belongs to; a different trip starts again from the beginning. */
  key: string | null
  /** Trip time elapsed since the span's start, in ms. */
  offset: number
  playing: boolean
  speed: PlaybackSpeed
}

export interface Playback {
  playing: boolean
  /** Replay time as ms since epoch, or null with no trip. */
  time: number | null
  /** Share of the span replayed so far, 0..1. */
  fraction: number
  speed: PlaybackSpeed
  span: TimeSpan | null
  /** False while there is nothing to replay (no trip, or no route points). */
  enabled: boolean
  play(): void
  pause(): void
  toggle(): void
  /** Jump to an absolute time (clamped to the span). Keeps playing if it was playing. */
  seek(time: number): void
  /** 1x -> 2x -> 4x -> 8x -> 1x. */
  cycleSpeed(): void
}

/**
 * Replay clock for one trip. `time` advances with requestAnimationFrame while playing, stops at the end, and starts
 * again from the beginning if played at the end. It goes back to the start, paused, whenever the trip changes
 * (a different car, day or trip). Nothing ever plays by itself.
 */
export function usePlayback(trip: Trip | null, route: Position[]): Playback {
  const key = trip?.id ?? null
  const startTime = trip?.startTime ?? null
  const endTime = trip?.endTime ?? null
  const span = useMemo<TimeSpan | null>(
    () => (startTime === null ? null : tripSpan({ startTime, endTime }, route)),
    [startTime, endTime, route],
  )
  const length = span ? span.end - span.start : 0
  // Nothing to replay without a span or without any route points.
  const usable = length > 0 && route.length > 0

  const [state, setState] = useState<State>({ key, offset: 0, playing: false, speed: 1 })
  // Derived, so a trip change starts over without an effect (the old state is simply for another key).
  const fresh = useCallback((s: State): State => (s.key === key ? s : { key, offset: 0, playing: false, speed: s.speed }), [key])
  const current = fresh(state)
  const offset = Math.min(current.offset, length)
  const playing = current.playing && usable
  const speed = current.speed

  useEffect(() => {
    if (!playing) return
    let last: number | null = null
    let id = 0
    const frame = (ts: number) => {
      const dt = last === null ? 0 : Math.min(ts - last, MAX_FRAME_MS)
      last = ts
      setState((s) => {
        const c = fresh(s)
        if (!c.playing) return c
        const next = c.offset + dt * c.speed * BASE_RATE
        return next >= length ? { ...c, offset: length, playing: false } : { ...c, offset: next }
      })
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [playing, length, fresh])

  const play = useCallback(() => {
    if (!usable) return
    setState((s) => {
      const c = fresh(s)
      return { ...c, offset: c.offset >= length ? 0 : c.offset, playing: true }
    })
  }, [usable, length, fresh])
  const pause = useCallback(() => setState((s) => ({ ...fresh(s), playing: false })), [fresh])
  const toggle = playing ? pause : play
  const seek = useCallback(
    (time: number) => {
      if (!span) return
      setState((s) => ({ ...fresh(s), offset: Math.min(length, Math.max(0, time - span.start)) }))
    },
    [span, length, fresh],
  )
  const cycleSpeed = useCallback(
    () =>
      setState((s) => {
        const c = fresh(s)
        return { ...c, speed: PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(c.speed) + 1) % PLAYBACK_SPEEDS.length] }
      }),
    [fresh],
  )

  return {
    playing,
    time: span ? span.start + offset : null,
    fraction: length > 0 ? offset / length : 0,
    speed,
    span,
    enabled: usable,
    play,
    pause,
    toggle,
    seek,
    cycleSpeed,
  }
}
