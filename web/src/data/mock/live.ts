// The live feed: periodic position messages, with signal gaps that release a late, out-of-order burst.
import type { Position, SignalGap } from '../types'
import { HEARTBEAT_MS } from './today'

/** After a gap ends the tracker keeps buffering this long, then sends everything at once. */
export const BUFFER_RELEASE_MS = 60_000

export interface FeedEnv {
  now(): number
  carIds: string[]
  gaps: SignalGap[]
  /** Current position of a car at `t`, or null if unknown. */
  positionAt(carId: string, t: number): Position | null
  /** Stored fixes with from <= fixTime <= to, ascending. */
  fixesBetween(carId: string, from: number, to: number): Position[]
}

export interface FeedHandlers {
  onPositions: (positions: Position[]) => void
  onMessage?: (receivedAt: number) => void
}

/** Starts the feed and returns its stop function. Moving cars report every tick, parked cars every HEARTBEAT_MS. */
export function startFeed(env: FeedEnv, handlers: FeedHandlers, tickMs: number): () => void {
  const lastSent = new Map<string, number>()
  const held = new Map<string, SignalGap>()

  const tick = () => {
    const t = env.now()
    const out: Position[] = []
    for (const carId of env.carIds) {
      const gap = env.gaps.find((g) => g.carId === carId && t > g.startTime && t < g.endTime + BUFFER_RELEASE_MS)
      if (gap) {
        held.set(carId, gap)
        continue
      }
      const pos = env.positionAt(carId, t)
      const due = pos !== null && (pos.motion || t - (lastSent.get(carId) ?? -Infinity) >= HEARTBEAT_MS)
      if (pos && due) {
        out.push(pos)
        lastSent.set(carId, t)
      }
      const released = held.get(carId)
      if (released) {
        held.delete(carId)
        // Newest first: the burst arrives out of order.
        out.push(...env.fixesBetween(carId, released.endTime, t).reverse())
        lastSent.set(carId, t)
      }
    }
    if (out.length > 0) {
      handlers.onPositions(out)
      handlers.onMessage?.(t)
    }
  }

  const timer = setInterval(tick, tickMs)
  return () => clearInterval(timer)
}
