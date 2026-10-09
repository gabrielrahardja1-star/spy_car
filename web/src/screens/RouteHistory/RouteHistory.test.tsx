import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { CAR_1, createFakeSource, position, trip } from '../../test/fakeSource'
import { localTime, renderApp, useFixedClock } from '../../test/render'
import { DEPOT, SITE_ZONE, TRIP_A, TRIP_B, dayScenario } from '../../test/scenario'

/** The day scenario, plus Car 01's route for its first trip: a fix every 5 minutes, 07:42 to 09:05, heading east at 40 km/h. */
function routedScenario() {
  const fixes = []
  for (let t = TRIP_A.startTime; t <= (TRIP_A.endTime ?? 0); t += 5 * 60_000) {
    const i = (t - TRIP_A.startTime) / 60_000
    fixes.push(position(CAR_1.id, t, { lat: 0.5, lon: 0.001 * i, speedKmh: 40, course: 90, motion: true }))
  }
  return createFakeSource({ geofences: [SITE_ZONE, DEPOT], positions: fixes, trips: [TRIP_A, TRIP_B] })
}

describe('RouteHistory', () => {
  useFixedClock()

  it('shows the server address under a trip that no geofence matched, and wording for places away from the site', async () => {
    const away = trip(CAR_1.id, localTime(7, 42), localTime(9, 5), {
      startPlace: null,
      endPlace: null,
      startAddress: 'Main Street',
      endAddress: 'Market Road',
      stops: [],
    })
    renderApp('/history', createFakeSource({ geofences: [SITE_ZONE], trips: [away] }))
    expect(await screen.findByText('Away \u2192 away')).toBeInTheDocument()
    expect(screen.getByText('From Main Street to Market Road')).toBeInTheDocument()
    expect(screen.getByText('Started away from site')).toBeInTheDocument()
    expect(screen.getByText('Stopped away from site')).toBeInTheDocument()
  })

  it('shows an em dash for the stops of a trip whose stops are unknown', async () => {
    const unknown = trip(CAR_1.id, localTime(7, 42), localTime(9, 5), { stopsKnown: false })
    renderApp('/history', createFakeSource({ trips: [unknown] }))
    await screen.findByText('Stops')
    expect(screen.getByText('Stops').nextSibling).toHaveTextContent('\u2014')
  })

  it('disables the next-day button on today and enables previous', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Thu 8 Oct 2026')
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeEnabled()
  })

  it('shows the day summary computed from the trips', async () => {
    renderApp('/history', dayScenario())
    expect(await screen.findByText('2 trips · 64 km · 2 h 10 min driving')).toBeInTheDocument()
  })

  it('lists the day oldest first and auto-selects the first trip', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Site → Town depot')
    const titles = screen.getAllByText(/ → |on the way/).map((e) => e.textContent)
    expect(titles).toEqual(['Site → Town depot', 'Town depot → Site'])

    expect(screen.getByRole('button', { name: /Site → Town depot/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Town depot → Site/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('expands the selected trip with stats and an event timeline', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Left Site zone')
    const card = screen.getByRole('group', { name: 'Site → Town depot' })
    expect(within(card).getByText('Distance').nextSibling).toHaveTextContent('41 km')
    expect(within(card).getByText('Driving').nextSibling).toHaveTextContent('1 h 12 min')
    expect(within(card).getByText('Stops').nextSibling).toHaveTextContent('2 · 11 min')
    const events = within(card).getAllByRole('listitem').map((li) => li.textContent)
    expect(events).toEqual(['07:42Left Site zone', '07:58Stopped 3 min', '08:36Stopped 8 min', '09:05Arrived Town depot'])
  })

  it('shows an In progress trip with its distance so far', async () => {
    renderApp('/history', dayScenario())
    expect(await screen.findByText(/In progress · 23 km so far/)).toBeInTheDocument()
    expect(screen.getByText('13:20 – now')).toBeInTheDocument()
  })

  it('selecting another trip expands it instead', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Left Site zone')
    await userEvent.click(screen.getByRole('button', { name: /Town depot → Site/ }))
    expect(screen.getByRole('button', { name: /Town depot → Site/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Left Site zone')).toBeNull()
  })

  it('feeds the playback bar from the selected trip', async () => {
    renderApp('/history', routedScenario())
    await screen.findByText('Left Site zone')
    const bar = screen.getByRole('group', { name: 'Playback' })
    expect(within(bar).getAllByText(/^\d\d:\d\d$/).map((e) => e.textContent)).toEqual(['07:42', '07:42', '09:05'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play route' })).toBeEnabled())
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '07:42')
    expect(screen.getByRole('button', { name: 'Playback speed, 1 times' })).toBeInTheDocument()
  })

  it('shows the route illustration when the real map cannot start, with the trip markers and the car callout', async () => {
    renderApp('/history', routedScenario())
    const map = await screen.findByRole('img', { name: /Illustrative map of the selected trip/ })
    expect(within(map).getByText('Start 07:42')).toBeInTheDocument()
    expect(within(map).getByText('Stop · 3 min')).toBeInTheDocument()
    expect(within(map).getByText('Stop · 8 min')).toBeInTheDocument()
    expect(within(map).getByText('Town depot 09:05')).toBeInTheDocument()
    expect(within(map).getByText('Car 01 at 07:42')).toBeInTheDocument()
    expect(within(map).getByText('40 km/h · 0 km in')).toBeInTheDocument()
  })

  it('starts and pauses the replay, and cycles the speed', async () => {
    renderApp('/history', routedScenario())
    await screen.findByText('Left Site zone')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play route' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Play route' }))
    expect(screen.getByRole('button', { name: 'Pause route' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pause route' }))
    expect(screen.getByRole('button', { name: 'Play route' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Playback speed, 1 times' }))
    expect(screen.getByRole('button', { name: 'Playback speed, 2 times' })).toHaveTextContent('2×')
  })

  it('seeks when the slider moves, and the car callout follows', async () => {
    renderApp('/history', routedScenario())
    const map = await screen.findByRole('img', { name: /Illustrative map of the selected trip/ })
    const slider = screen.getByRole('slider', { name: 'Playback position' })
    await waitFor(() => expect(slider).toBeEnabled())
    fireEvent.change(slider, { target: { value: '500' } })
    // Halfway through 07:42 - 09:05 is 08:23 (the clock shows minutes, rounded down).
    expect(within(screen.getByRole('group', { name: 'Playback' })).getByText('08:23')).toBeInTheDocument()
    expect(slider).toHaveAttribute('aria-valuetext', '08:23')
    expect(within(map).getByText('Car 01 at 08:23')).toBeInTheDocument()
  })

  it('jumps the replay to a timeline event when its row is pressed', async () => {
    renderApp('/history', routedScenario())
    await screen.findByText('Left Site zone')
    const row = screen.getByRole('button', { name: 'Go to 08:36, Stopped 8 min' })
    await waitFor(() => expect(row).toBeEnabled())
    expect(row).toHaveStyle({ color: 'var(--orange)' })
    await userEvent.click(row)
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '08:36')
    await userEvent.click(screen.getByRole('button', { name: 'Go to 09:05, Arrived Town depot' }))
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '09:05')
  })

  it('goes back to the start, paused, when another trip is selected', async () => {
    renderApp('/history', routedScenario())
    await screen.findByText('Left Site zone')
    const slider = screen.getByRole('slider', { name: 'Playback position' })
    await waitFor(() => expect(slider).toBeEnabled())
    fireEvent.change(slider, { target: { value: '900' } })
    expect(slider).toHaveAttribute('aria-valuetext', '08:56')
    await userEvent.click(screen.getByRole('button', { name: /Town depot → Site/ }))
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '13:20')
    expect(screen.getByRole('button', { name: 'Play route' })).toBeInTheDocument()
  })

  it('asks for the selected trip route once, whatever the clock does', async () => {
    const source = routedScenario()
    const getRoute = vi.spyOn(source, 'getRoute')
    renderApp('/history', source)
    await screen.findByText('Left Site zone')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    const forTrip = getRoute.mock.calls.filter(([carId, from]) => carId === CAR_1.id && from === TRIP_A.startTime)
    expect(forTrip).toHaveLength(1)
    expect(forTrip[0][2]).toBe((TRIP_A.endTime ?? 0) + 1)
  })

  it('disables the playback bar, with a note on the map, when the trip has no route points', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Left Site zone')
    expect(await screen.findByText('No route points for this trip')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Playback' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Play route' })).toBeDisabled()
    expect(screen.getByRole('slider', { name: 'Playback position' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Go to 07:58/ })).toBeDisabled()
  })

  it('shows a loading note on the map and a disabled bar while the route loads', async () => {
    const source = routedScenario()
    source.getRoute = () => new Promise(() => {})
    renderApp('/history', source)
    await screen.findByText('Left Site zone')
    expect(screen.getByText('Loading route...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play route' })).toBeDisabled()
  })

  it('says when the route cannot be loaded, and still shows the map and the trip', async () => {
    const source = routedScenario()
    source.getRoute = async () => {
      throw new Error('down')
    }
    renderApp('/history', source)
    expect(await screen.findByText("Can't load this route")).toBeInTheDocument()
    expect(screen.getByText('Site → Town depot')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Playback' })).toHaveAttribute('aria-disabled', 'true')
    expect(await screen.findByRole('img', { name: /Illustrative map/ })).toBeInTheDocument()
  })

  it('has the 2D/3D toggle and the view controls over the map', async () => {
    renderApp('/history', routedScenario())
    await screen.findByText('Left Site zone')
    expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '2D' }))
    expect(screen.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Fit route' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
  })

  it('steps to the previous day and back, with no trips shown for an empty day', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Thu 8 Oct 2026')
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(await screen.findByText('Wed 7 Oct 2026')).toBeInTheDocument()
    expect(await screen.findByText('No trips on this day')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled()
    // The map stays, with a note, and the playback bar has nothing to play.
    expect(screen.getByText('No route to show on this day')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Playback' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Play route' })).toBeDisabled()
    expect(await screen.findByRole('img', { name: 'Illustrative map, no trip selected' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(await screen.findByText('Thu 8 Oct 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(await screen.findByText('Site → Town depot')).toBeInTheDocument()
  })

  it('switches car', async () => {
    renderApp('/history', dayScenario())
    await screen.findByText('Site → Town depot')
    await userEvent.click(screen.getByRole('button', { name: 'Car 02' }))
    expect(await screen.findByText('Supplier yard → Site')).toBeInTheDocument()
    expect(screen.queryByText('Site → Town depot')).toBeNull()
    expect(screen.getByText('1 trip · 38 km · 1 h 15 min driving')).toBeInTheDocument()
  })

  it('shows an empty state when the data has no trips', async () => {
    renderApp('/history', createFakeSource())
    expect(await screen.findByText('No trips on this day')).toBeInTheDocument()
    expect(screen.getByText('0 trips · 0 km · 0 min driving')).toBeInTheDocument()
  })

  it('shows loading and error states', async () => {
    const source = createFakeSource()
    source.getTrips = async () => {
      throw new Error('down')
    }
    renderApp('/history', source)
    expect(screen.getByText('Loading cars...')).toBeInTheDocument()
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
  })

  it('runs on the mock data source', async () => {
    renderApp('/history')
    expect(await screen.findByText('Thu 8 Oct 2026')).toBeInTheDocument()
    expect(await screen.findByText(/trips? · .* driving/)).toBeInTheDocument()
  })
})
