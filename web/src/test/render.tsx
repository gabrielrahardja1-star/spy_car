import { afterEach, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../app/routes'
import { DataProvider } from '../data/DataProvider'
import type { DataSource } from '../data/source'
import { createMockDataSource } from '../data/mock'

/** 2026-10-08 14:18 in Asia/Makassar (UTC+8), a local afternoon. */
export const FIXED_NOW = Date.UTC(2026, 9, 8, 6, 18, 0)

/** Source used by tests that do not supply their own. Its clock is frozen at FIXED_NOW. */
export function createTestSource(): DataSource {
  return createMockDataSource({ now: () => FIXED_NOW })
}

export function renderApp(path = '/', source: DataSource = createTestSource()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <DataProvider source={source}>
      <RouterProvider router={router} />
    </DataProvider>,
  )
}

/** Freezes Date at FIXED_NOW and fakes setInterval, so useNow ticks only when a test advances the clock. */
export function useFixedClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}

/** A local time on the fixed test day (Asia/Makassar, UTC+8). `dayOffset` -1 = yesterday. */
export function localTime(hour: number, minute = 0, dayOffset = 0): number {
  return Date.UTC(2026, 9, 8 + dayOffset, hour - 8, minute)
}
