import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CAR_1, createFakeSource, position } from '../../test/fakeSource'
import { FIXED_NOW, renderApp, useFixedClock } from '../../test/render'

const trucks = () => screen.getByRole('list', { name: 'All trucks' })
const truckRow = (name: string) => within(trucks()).getByText(new RegExp(`^${name}`)).closest('li')!

describe('Manage', () => {
  useFixedClock()

  it('is only for admins: no tab, and a note instead of the tools', async () => {
    renderApp('/manage', createFakeSource({ positions: [position(CAR_1.id, FIXED_NOW - 1000)] }))
    expect(await screen.findByText(/Only an admin account that is not read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add truck' })).toBeNull()
  })

  it('shows a Manage tab to admins, opening on the trucks with their type and tracker', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: 'Manage' }))
    await screen.findByRole('list', { name: 'All trucks' })
    expect(truckRow('DT-01')).toHaveTextContent('Teltonika · IMEI 490154203237518 · SIM +62 812 0000 0001')
    expect(within(truckRow('DT-01')).queryByText('Test')).toBeNull()
    expect(truckRow('DT-02')).toHaveTextContent('Simulator · ID sim-dt-02')
    expect(within(truckRow('DT-02')).getByText('Test')).toBeInTheDocument()
  })

  it('adds a test truck with a made-up simulator ID and shows the command to drive it', async () => {
    renderApp('/manage')
    await userEvent.click(await screen.findByRole('button', { name: 'Add truck' }))
    await userEvent.type(screen.getByLabelText('Name'), 'DT-03')
    expect(screen.getByLabelText('Tracker ID')).toHaveValue('sim-dt-03')
    await userEvent.click(screen.getByRole('button', { name: 'Save truck' }))
    const row = await waitFor(() => truckRow('DT-03'))
    expect(row).toHaveTextContent('Simulator · ID sim-dt-03')
    // The setup steps open straight after adding.
    expect(within(row).getByText(/npm run simulate-car -- --host SERVER-IP --id sim-dt-03 --profile dump-truck/)).toBeInTheDocument()
  })

  it('adds a phone-app test truck with the ID from the app', async () => {
    renderApp('/manage')
    await userEvent.click(await screen.findByRole('button', { name: 'Add truck' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Phone test')
    await userEvent.click(screen.getByRole('button', { name: 'Phone app' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save truck' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the device identifier shown in the Traccar Client app.')
    await userEvent.type(screen.getByLabelText('Device identifier'), '847291')
    await userEvent.click(screen.getByRole('button', { name: 'Save truck' }))
    const row = await waitFor(() => truckRow('Phone test'))
    expect(row).toHaveTextContent('http://SERVER-IP:5055')
    expect(row).toHaveTextContent('847291')
  })

  it('adds a real truck only with a model and a valid, unused IMEI, then shows the tracker settings', async () => {
    renderApp('/manage')
    await userEvent.click(await screen.findByRole('button', { name: 'Add truck' }))
    await userEvent.type(screen.getByLabelText('Name'), 'DT-04')
    await userEvent.click(screen.getByRole('button', { name: 'Real truck' }))
    const save = () => userEvent.click(screen.getByRole('button', { name: 'Save truck' }))
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('Choose the tracker model.')
    await userEvent.selectOptions(screen.getByLabelText('Tracker model'), 'teltonika')
    await userEvent.type(screen.getByLabelText('IMEI'), '356938035643808')
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('does not check out')
    await userEvent.clear(screen.getByLabelText('IMEI'))
    await userEvent.type(screen.getByLabelText('IMEI'), '490154203237518')
    await save()
    expect(await screen.findByRole('alert')).toHaveTextContent('Tracker ID 490154203237518 is already used by DT-01.')
    await userEvent.clear(screen.getByLabelText('IMEI'))
    await userEvent.type(screen.getByLabelText('IMEI'), '356938035643809')
    await userEvent.type(screen.getByLabelText('SIM number (optional)'), '+62 812 5555')
    await save()
    const row = await waitFor(() => truckRow('DT-04'))
    expect(row).toHaveTextContent('Teltonika · IMEI 356938035643809 · SIM +62 812 5555')
    expect(row).toHaveTextContent('5027')
    expect(row).toHaveTextContent('TELTONIKA_BIND=0.0.0.0')
  })

  it('disables a truck (gone from the live map) and deletes one only after a warning', async () => {
    renderApp('/manage')
    await screen.findByRole('list', { name: 'All trucks' })
    await userEvent.click(within(truckRow('DT-02')).getByRole('button', { name: 'Disable' }))
    expect(await within(truckRow('DT-02')).findByText(/Disabled/)).toBeInTheDocument()
    await userEvent.click(within(truckRow('DT-01')).getByRole('button', { name: 'Delete' }))
    expect(truckRow('DT-01')).toHaveTextContent('This cannot be undone. To keep its history, disable it instead.')
    await userEvent.click(within(truckRow('DT-01')).getByRole('button', { name: 'Keep' }))
    expect(truckRow('DT-01')).not.toHaveTextContent('cannot be undone')

    await userEvent.click(screen.getByRole('link', { name: 'Live map' }))
    expect(await screen.findByText('DT-01')).toBeInTheDocument()
    expect(screen.queryByText('DT-02')).toBeNull()
  })

  it('adds a start point pasted as on WhatsApp, warns about an overlap, edits and deletes', async () => {
    renderApp('/manage')
    await userEvent.click(await screen.findByRole('button', { name: 'Locations (6)' }))
    expect(within(screen.getByRole('list', { name: 'Start points' })).getByText('Belakang Conveyor')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'End point' })).getByText('Area 2')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Checkpoints' })).getByText('CP Area 2 gate')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
    const save = () => userEvent.click(screen.getByRole('button', { name: 'Save location' }))
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('Give the location a name.')

    // The size follows the type until it is typed by hand.
    expect(screen.getByLabelText('Size (radius, m)')).toHaveValue(50)
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'checkpoint')
    expect(screen.getByLabelText('Size (radius, m)')).toHaveValue(30)
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'place')

    await userEvent.type(screen.getByLabelText('Name'), 'Workshop')
    await userEvent.type(screen.getByLabelText('Location'), `long : 115°16'40.00"E{enter}Lat :   3°10'30.00"S`)
    await save()
    const starts = () => screen.getByRole('list', { name: 'Start points' })
    const row = (await within(starts()).findByText('Workshop')).closest('li')!
    expect(row).toHaveTextContent(`3°10'30.00"S 115°16'40.00"E · 50 m`)

    // Right on top of Klinik: warned first, saved on the second press.
    await userEvent.click(screen.getByRole('button', { name: 'Add location' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Klinik 2')
    await userEvent.type(screen.getByLabelText('Location'), '-3.178875, 115.272158')
    await save()
    expect(screen.getByRole('alert')).toHaveTextContent('This circle overlaps Klinik.')
    await save()
    expect(await within(starts()).findByText('Klinik 2')).toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await userEvent.clear(screen.getByLabelText('Size (radius, m)'))
    await userEvent.type(screen.getByLabelText('Size (radius, m)'), '80')
    await save()
    const edited = (await within(starts()).findByText(/· 80 m$/)).closest('li')!
    expect(edited).toHaveTextContent('Workshop')

    await userEvent.click(within(edited).getByRole('button', { name: 'Delete' }))
    expect(edited).toHaveTextContent('Delete Workshop for everyone? Trips from or to it lose its name.')
    await userEvent.click(within(edited).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(starts()).not.toHaveTextContent('Workshop'))
  })
})
