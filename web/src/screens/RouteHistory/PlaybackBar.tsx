import type { KeyboardEvent } from 'react'
import { formatClock } from '../../data/format'
import styles from './PlaybackBar.module.css'
import type { PlaybackSpeed } from './usePlayback'

/** The scrubber works in thousandths of the trip, so a drag is smooth whatever the trip's length. */
const SCRUB_MAX = 1000
/** Arrow keys move by 1% of the trip, Page Up/Down by 10%. */
const KEY_STEP = 0.01
const KEY_PAGE = 0.1

export interface PlaybackBarProps {
  /** Nothing to replay (no trip, or its route is not available). */
  disabled: boolean
  playing: boolean
  speed: PlaybackSpeed
  /** Replay time, ms since epoch. */
  time: number | null
  /** Share of the trip replayed, 0..1. */
  fraction: number
  start: number | null
  /** Null while the trip is still under way: the end label then reads "now". */
  end: number | null
  /** Where stops begin on the scrubber, 0..1. */
  ticks: number[]
  onToggle(): void
  /** Seek to a share (0..1) of the trip. */
  onSeek(fraction: number): void
  onCycleSpeed(): void
}

const clock = (t: number | null) => (t === null ? '--:--' : formatClock(t))

export function PlaybackBar({ disabled, playing, speed, time, fraction, start, end, ticks, onToggle, onSeek, onCycleSpeed }: PlaybackBarProps) {
  const percent = `${Math.min(100, Math.max(0, fraction * 100))}%`

  // Arrow keys step by a visible amount (the native step is 0.1% of the trip, a few seconds).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const jump: Record<string, number> = { ArrowRight: KEY_STEP, ArrowUp: KEY_STEP, ArrowLeft: -KEY_STEP, ArrowDown: -KEY_STEP, PageUp: KEY_PAGE, PageDown: -KEY_PAGE }
    if (e.key === 'Home') onSeek(0)
    else if (e.key === 'End') onSeek(1)
    else if (e.key in jump) onSeek(Math.min(1, Math.max(0, fraction + jump[e.key])))
    else return
    e.preventDefault()
  }

  return (
    <div className={styles.playback} role="group" aria-label="Playback" aria-disabled={disabled || undefined}>
      <button type="button" className={styles.playButton} aria-label={playing ? 'Pause route' : 'Play route'} disabled={disabled} onClick={onToggle}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}
        </svg>
      </button>
      <div className={styles.playTime}>{clock(time)}</div>
      <div className={styles.scrub}>
        <div className={styles.scrubber}>
          <div className={styles.track}>
            <div className={styles.trackBar} />
            <div className={styles.trackFill} style={{ width: percent }} />
            {ticks.map((t, i) => (
              <div key={i} className={styles.tick} style={{ left: `${t * 100}%` }} />
            ))}
          </div>
          {/* The real control: transparent over the drawn track, so it brings pointer, touch and keyboard for free. */}
          <input
            type="range"
            className={styles.slider}
            min={0}
            max={SCRUB_MAX}
            step={1}
            value={Math.round(fraction * SCRUB_MAX)}
            disabled={disabled}
            aria-label="Playback position"
            aria-valuetext={clock(time)}
            onChange={(e) => onSeek(Number(e.target.value) / SCRUB_MAX)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={styles.range}>
          <span>{clock(start)}</span>
          <span>{start === null ? '--:--' : end === null ? 'now' : formatClock(end)}</span>
        </div>
      </div>
      <button type="button" className={styles.speed} aria-label={`Playback speed, ${speed} times`} disabled={disabled} onClick={onCycleSpeed}>
        {speed}×
      </button>
    </div>
  )
}
