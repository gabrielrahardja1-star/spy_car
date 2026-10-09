import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CAR_1, CAR_2, createFakeSource, position, trip } from '../../test/fakeSource'
import { FIXED_NOW, localTime, renderApp, useFixedClock } from '../../test/render'
import { SITE_ZONE, dayScenario } from '../../test/scenario'

const carButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('LiveMap', () => {
  useFixedClock()

  it('renders a card per car from the mock data source', async () => {
    renderApp('/')
    expect(await screen.findByText('Car 01')).toBeInTheDocument()
    expect(screen.getByText('Car 02')).toBeInTheDocument()
    expect(screen.getAllByText('[Driver name]').length).toBeGreaterThan(0)
  })

  it('shows no driver line when the car has no driver label (real tracker data)', async () => {
    const source = createFakeSource({ cars: [{ ...CAR_1, driver: '' }, CAR_2], positions: [position(CAR_1.id, FIXED_NOW - 1000), position(CAR_2.id, FIXED_NOW - 1000)] })
    renderApp('/', source)
    await screen.findByText('Car 02')
    expect(within(carButton('Car 01')).queryByText('[Driver name]')).toBeNull()
    expect(within(carButton('Car 02')).getByText('[Driver name]')).toBeInTheDocument()
  })

  it('selects a car when its card is clicked', async () => {
    renderApp('/', createFakeSource({ positions: [position(CAR_1.id, FIXED_NOW - 1000), position(CAR_2.id, FIXED_NOW - 1000)] }))
    await screen.findByText('Car 02')
    expect(carButton('Car 01')).toHaveAttribute('aria-pressed', 'true')
    expect(carButton('Car 02')).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(carButton('Car 02'))
    expect(carButton('Car 02')).toHaveAttribute('aria-pressed', 'true')
    expect(carButton('Car 01')).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggles 2D/3D', async () => {
    renderApp('/')
    expect(screen.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '2D' }))
    expect(screen.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows speed, last seen, today and the route for a moving car', async () => {
    renderApp('/', dayScenario())
    await screen.findByText('Town depot → Site · left 13:20')
    const card = carButton('Car 01')
    expect(within(card).getByText('Moving')).toBeInTheDocument()
    expect(within(card).getByText('Speed').nextSibling).toHaveTextContent('42 km/h')
    expect(within(card).getByText('Last seen').nextSibling).toHaveTextContent('4 s ago')
    expect(within(card).getByText('Today').nextSibling).toHaveTextContent('64 km')
  })

  it('shows a car with a stale fix as No signal, never as parked', async () => {
    renderApp('/', dayScenario())
    await screen.findByText('Car 02')
    const card = carButton('Car 02')
    expect(within(card).getByText('No signal')).toBeInTheDocument()
    expect(within(card).queryByText('Parked')).toBeNull()
    expect(within(card).queryByText('Parked for')).toBeNull()
    expect(within(card).getByText('Last seen').nextSibling).toHaveTextContent('38 min ago')
    expect(await within(card).findByText('No signal since 13:40')).toBeInTheDocument()
    expect(screen.getByText('1 moving · 0 parked · 1 no signal')).toBeInTheDocument()
  })

  it('shows a parked car inside the site zone with its arrival time', async () => {
    const source = createFakeSource({
      geofences: [SITE_ZONE],
      positions: [position(CAR_1.id, FIXED_NOW - 60_000, { lat: 0, lon: 0 }), position(CAR_2.id, FIXED_NOW - 5000, { speedKmh: 30, motion: true, lat: 5, lon: 5 })],
      trips: [trip(CAR_1.id, localTime(13, 0), localTime(13, 40), { startPlace: 'Town depot', endPlace: 'Site', distanceM: 38_000 })],
    })
    renderApp('/', source)
    await screen.findByText('Inside Site zone · arrived 13:40')
    const card = carButton('Car 01')
    expect(within(card).getByText('Parked')).toBeInTheDocument()
    expect(within(card).getByText('Parked for')).toBeInTheDocument()
    expect(within(card).getByText('Today').nextSibling).toHaveTextContent('38 km')
    expect(screen.getByText('1 moving · 1 parked')).toBeInTheDocument()
  })

  it('takes the map callouts from the car data', async () => {
    renderApp('/', dayScenario())
    const map = await screen.findByRole('img', { name: /Illustrative map/ })
    expect(within(map).getByText('Car 01 · Moving')).toBeInTheDocument()
    expect(within(map).getByText('42 km/h · 4 s ago')).toBeInTheDocument()
    expect(within(map).getByText('Car 02 · No signal')).toBeInTheDocument()
    expect(within(map).getByText('Last seen 38 min ago')).toBeInTheDocument()
  })

  it('says it cannot reach the server when loading cars fails', async () => {
    const source = createFakeSource()
    source.getCars = async () => {
      throw new Error('down')
    }
    renderApp('/', source)
    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
  })

  it('shows a loading note before the cars arrive', () => {
    renderApp('/', createFakeSource())
    expect(screen.getByText('Loading cars...')).toBeInTheDocument()
  })
})

describe('LiveMap map fallback', () => {
  it('shows the illustration naming both cars when the real map cannot start (no WebGL here)', async () => {
    renderApp('/')
    const map = await screen.findByRole('img', { name: /Illustrative map/ })
    expect(map).toHaveAccessibleName(/Car 01.*Car 02/)
  })
})
