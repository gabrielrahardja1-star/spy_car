import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DataProvider, useDataSource } from './DataProvider'
import type { DataSource } from './source'

vi.mock('./derive', () => ({
  sortPositions: (p: unknown[]) => p,
  toLiveCar: vi.fn(),
  findSignalGaps: vi.fn(),
}))

const fakeSource = (): DataSource => ({
  getCars: async () => [],
  getGeofences: async () => [],
  getLatestPositions: async () => [],
  subscribe: vi.fn(() => () => {}),
  getRoute: async () => [],
  getTrips: async () => [],
  getStops: async () => [],
  getSummary: async () => [],
})

describe('DataProvider', () => {
  it('throws a clear error when hooks are used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useDataSource())).toThrow(/inside <DataProvider>/)
    spy.mockRestore()
  })

  it('provides the given source and subscribes exactly once', () => {
    const source = fakeSource()
    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider source={source}>{children}</DataProvider>
    const { result, unmount } = renderHook(() => useDataSource(), { wrapper })
    expect(result.current).toBe(source)
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    unmount()
  })
})
