// OWNED BY: hooks agent.
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DataSource } from './source'
import type { Position } from './types'
import { createDataSource } from './factory'
import { sortPositions } from './derive'

/** Max positions kept per car in the live buffer. */
export const MAX_BUFFER_PER_CAR = 600

const NO_POSITIONS: Position[] = []

/**
 * Provider-level live state shared by every hook: one `source.subscribe()` per provider feeds
 * (a) a per-car position buffer and (b) the time of the last real message.
 * Exposed to React through a subscribe/getSnapshot pair (useSyncExternalStore).
 */
export class LiveStore {
  private buffers = new Map<string, Position[]>()
  private lastMessage: number | null = null
  private version = 0
  private listeners = new Set<() => void>()

  private readonly source: DataSource

  constructor(source: DataSource) {
    this.source = source
  }

  /** Starts the single live subscription. Returns the stop function. */
  start(): () => void {
    return this.source.subscribe({
      onPositions: (positions) => this.merge(positions),
      onMessage: (receivedAt) => {
        this.lastMessage = receivedAt
        this.emit()
      },
    })
  }

  /** Merge fixes into the per-car buffers. Sorted by fixTime, duplicates dropped, capped to the newest fixes. */
  merge(positions: Position[]): void {
    if (positions.length === 0) return
    const byCar = new Map<string, Position[]>()
    for (const p of positions) {
      const list = byCar.get(p.carId)
      if (list) list.push(p)
      else byCar.set(p.carId, [p])
    }
    for (const [carId, incoming] of byCar) {
      const merged = sortPositions([...(this.buffers.get(carId) ?? []), ...incoming])
      this.buffers.set(carId, merged.length > MAX_BUFFER_PER_CAR ? merged.slice(-MAX_BUFFER_PER_CAR) : merged)
    }
    this.emit()
  }

  /** Sorted recent positions of one car. Identity changes only when the buffer changes. */
  getBuffer(carId: string): Position[] {
    return this.buffers.get(carId) ?? NO_POSITIONS
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  /** Increments whenever any buffer changes. */
  getVersion = (): number => this.version
  getLastMessageAt = (): number | null => this.lastMessage

  private emit(): void {
    this.version++
    for (const l of [...this.listeners]) l()
  }
}

interface DataContextValue {
  source: DataSource
  store: LiveStore
}

const DataContext = createContext<DataContextValue | null>(null)

function useDataContext(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('Data hooks must be used inside <DataProvider>')
  return ctx
}

/** The DataSource of the nearest <DataProvider>. Throws outside one. */
export function useDataSource(): DataSource {
  return useDataContext().source
}

/** Internal: the provider's shared live store. */
export function useLiveStore(): LiveStore {
  return useDataContext().store
}

/** Provides the DataSource to hooks. Without a `source` prop it builds one from `config.dataSource`. */
export function DataProvider({ source, children }: { source?: DataSource; children: ReactNode }): ReactNode {
  const [own] = useState<DataSource>(() => source ?? createDataSource())
  const effective = source ?? own
  const store = useMemo(() => new LiveStore(effective), [effective])
  useEffect(() => store.start(), [store])
  const value = useMemo(() => ({ source: effective, store }), [effective, store])
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
