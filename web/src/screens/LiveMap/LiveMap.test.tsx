import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CAR_1, CAR_2, createFakeSource, position, trip } from '../../test/fakeSource'
import { FIXED_NOW, localTime, renderApp, useFixedClock } from '../../test/render'
import { SITE_ZONE, dayScenario } from '../../test/scenario'

const carButton = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

describe('LiveMap', () => {
  useFixedClock()

  it('renders a card per truck from the mock data source', async () => {
    renderApp('/')
    expect(await screen.findByText('DT-01')).toBeInTheDocument()
    expect(screen.getByText('DT-02')).toBeInTheDocument()
    expect(screen.getAllByText('[Driver name]').length).toBeGreaterThan(0)
  })

  it("shows each truck's last checkpoint pass today", async () => {
    renderApp('/')
    await screen.findByText('DT-01')
    expect(await within(carButton('DT-01')).findByText(/^Passed CP\d .* · \d\d:\d\d$/)).toBeInTheDocument()
    expect(await within(carButton('DT-02')).findByText(/^Passed CP2 South gate · /)).toBeInTheDocument()
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
    expect(screen.getByText('Loading trucks...')).toBeInTheDocument()
  })
})

describe('LiveMap map fallback', () => {
  it('shows the illustration naming both trucks when the real map cannot start (no WebGL here)', async () => {
    renderApp('/')
    const map = await screen.findByRole('img', { name: /Illustrative map/ })
    expect(map).toHaveAccessibleName(/DT-01.*DT-02/)
  })
})

describe('LiveMap checkpoints', () => {
  useFixedClock()

  it('lists the checkpoints for everyone, with no editing when the source cannot edit', async () => {
    renderApp('/', createFakeSource({ geofences: [{ id: 'cp', name: 'CP1 Gate', kind: 'checkpoint', polygon: [[0, 0], [0, 1], [1, 1], [0, 0]] }] }))
    await userEvent.click(await screen.findByRole('button', { name: 'Checkpoints (1)' }))
    expect(screen.getByText('CP1 Gate')).toBeInTheDocument()
    expect(screen.getByText('Shape drawn in Traccar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add checkpoint' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('adds a checkpoint from pasted coordinates, edits it and deletes it after confirming', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Checkpoints (4)' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add checkpoint' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the checkpoint a name.')

    await userEvent.type(screen.getByLabelText('Name'), 'CP5 Tip face')
    await userEvent.type(screen.getByLabelText('Location'), 'nowhere')
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Tap the map, or paste the location')

    await userEvent.clear(screen.getByLabelText('Location'))
    await userEvent.type(screen.getByLabelText('Location'), '-3.171900, 115.282100')
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }))
    const list = await screen.findByRole('list', { name: 'Checkpoints' })
    const row = (await within(list).findByText('CP5 Tip face')).closest('li')!
    expect(row).toHaveTextContent(`3°10'18.84"S 115°16'55.56"E · 30 m`)
    expect(screen.getByRole('button', { name: 'Checkpoints (5)' })).toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Location')).toHaveValue(`3°10'18.84"S 115°16'55.56"E`)
    await userEvent.clear(screen.getByLabelText('Size (radius, m)'))
    await userEvent.type(screen.getByLabelText('Size (radius, m)'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }))
    const edited = (await within(screen.getByRole('list', { name: 'Checkpoints' })).findByText(/· 50 m$/)).closest('li')!
    expect(edited).toHaveTextContent('CP5 Tip face')

    await userEvent.click(within(edited).getByRole('button', { name: 'Delete' }))
    expect(edited).toHaveTextContent('Delete CP5 Tip face for everyone?')
    await userEvent.click(within(edited).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('button', { name: 'Checkpoints (4)' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Checkpoints' })).queryByText('CP5 Tip face')).toBeNull()
  })
})

