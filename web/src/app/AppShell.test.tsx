import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { DataProvider } from '../data/DataProvider'
import type { ConnectionState } from '../data/source'
import { routes } from './routes'
import { SessionContext } from './session'
import { CAR_1, CAR_2, createFakeSource, position } from '../test/fakeSource'
import { FIXED_NOW, renderApp, useFixedClock } from '../test/render'

describe('AppShell', () => {
  useFixedClock()

  it('renders the three tabs as links and marks the active one', () => {
    renderApp('/history')
    const nav = screen.getByRole('navigation', { name: 'Views' })
    expect(nav.querySelectorAll('a')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Route history' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Live map' })).not.toHaveAttribute('aria-current')
  })

  it('shows the number of cars from the data', async () => {
    renderApp('/', createFakeSource({ cars: [CAR_1, CAR_2] }))
    expect(await screen.findByText('Purchasing · 2 cars')).toBeInTheDocument()
  })

  it('says it is waiting for data before the first live message', async () => {
    renderApp('/', createFakeSource())
    await screen.findByText('Purchasing · 2 cars')
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('waiting for data')).toBeInTheDocument()
    expect(screen.queryByText(/updated/)).toBeNull()
  })

  it('counts the "updated N s ago" chip up from the last message', async () => {
    const source = createFakeSource({ positions: [position(CAR_1.id, FIXED_NOW - 4000)] })
    renderApp('/', source)
    await screen.findByText('Purchasing · 2 cars')

    act(() => source.push([position(CAR_1.id, FIXED_NOW - 4000)], FIXED_NOW - 4000))
    expect(screen.getByText('updated 4 s ago')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText('updated 7 s ago')).toBeInTheDocument()

    act(() => source.push([position(CAR_1.id, FIXED_NOW)], FIXED_NOW + 3000))
    expect(screen.getByText('updated 0 s ago')).toBeInTheDocument()
  })

  it('has no log-out button in mock mode (no session)', async () => {
    renderApp('/', createFakeSource())
    await screen.findByText('Purchasing · 2 cars')
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  })

  it('has a log-out button when there is a session, and it ends the session', async () => {
    const logout = vi.fn()
    render(
      <SessionContext.Provider value={{ logout }}>
        <DataProvider source={createFakeSource()}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/'] })} />
        </DataProvider>
      </SessionContext.Provider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  describe('live link state', () => {
    function withConnection() {
      const source = createFakeSource({ positions: [position(CAR_1.id, FIXED_NOW - 4000)] })
      let emit: (s: ConnectionState) => void = () => {}
      const linked = {
        ...source,
        onConnectionChange: (l: (s: ConnectionState) => void) => {
          emit = l
          l('connected')
          return () => {}
        },
      }
      return { source, linked, emit: (s: ConnectionState) => act(() => emit(s)) }
    }

    it('says "reconnecting" only after the link was up, and "offline" for a long outage', async () => {
      const { source, linked, emit } = withConnection()
      renderApp('/', linked)
      await screen.findByText('Purchasing · 2 cars')

      emit('reconnecting') // first connect: nothing to warn about
      expect(screen.getByText('waiting for data')).toBeInTheDocument()

      act(() => source.push([position(CAR_1.id, FIXED_NOW - 4000)], FIXED_NOW - 4000))
      emit('reconnecting')
      expect(screen.getByText('updated 4 s ago \u00b7 reconnecting')).toBeInTheDocument()
      emit('offline')
      expect(screen.getByText('updated 4 s ago \u00b7 offline')).toBeInTheDocument()
      emit('connected')
      expect(screen.getByText('updated 4 s ago')).toBeInTheDocument()
    })

    it('says "offline" even before the first message', async () => {
      const { linked, emit } = withConnection()
      renderApp('/', linked)
      await screen.findByText('Purchasing · 2 cars')
      emit('offline')
      expect(screen.getByText('waiting for data \u00b7 offline')).toBeInTheDocument()
    })
  })
})
