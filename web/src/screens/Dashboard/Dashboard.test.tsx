import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { addDays, dayBounds, formatDistance, formatDuration } from '../../data/format'
import { summarizeTrips } from '../../data/derive'
import type { Trip } from '../../data/types'
import { CAR_1, CAR_2, createFakeSource, position, trip } from '../../test/fakeSource'
import { FIXED_NOW, createTestSource, localTime, renderApp, useFixedClock } from '../../test/render'
import { dayScenario, TRIP_A, TRIP_B, TRIP_C } from '../../test/scenario'
import { chartAxis } from './chartAxis'

const cardValue = (label: string) => screen.getByText(label).nextSibling

describe('chartAxis', () => {
  it('draws four ticks that are whole numbers, topping the largest bar', () => {
    expect(chartAxis(110)).toEqual({ ticks: [120, 80, 40, 0], max: 120 })
    expect(chartAxis(64).ticks).toEqual([90, 60, 30, 0])
    expect(chartAxis(0).ticks).toEqual([30, 20, 10, 0])
    expect(chartAxis(120).max).toBeGreaterThanOrEqual(120)
  })

  it('stays finite for empty, negative or broken input', () => {
    for (const bad of [0, -5, NaN, Infinity, 0.4]) {
      const axis = chartAxis(bad)
      expect(axis.ticks.every(Number.isFinite)).toBe(true)
      expect(axis.max).toBeGreaterThan(0)
    }
    expect(chartAxis(NaN).ticks).toEqual([30, 20, 10, 0])
  })
})

describe('Dashboard', () => {
  useFixedClock()

  it('shows the date line and the four stat cards for today', async () => {
    renderApp('/dashboard', dayScenario())
    expect(await screen.findByText('Distance today')).toBeInTheDocument()
    expect(screen.getByText('Thu 8 Oct 2026 · as of 14:18')).toBeInTheDocument()
    expect(cardValue('Distance today')).toHaveTextContent('102 km')
    expect(cardValue('Distance today')?.nextSibling).toHaveTextContent('Car 01 64 · Car 02 38')
    expect(cardValue('Driving time today')).toHaveTextContent('3 h 25 min')
    expect(cardValue('Driving time today')?.nextSibling).toHaveTextContent('Car 01 2:10 · Car 02 1:15')
    expect(cardValue('Trips today')).toHaveTextContent('3')
    expect(cardValue('Trips today')?.nextSibling).toHaveTextContent('1 in progress')
    expect(cardValue('Signal gaps today')).toHaveTextContent('1')
    expect(cardValue('Signal gaps today')?.nextSibling).toHaveTextContent('Car 02 · 6 min at 12:58')
  })

  it('shows None when there are no signal gaps', async () => {
    renderApp('/dashboard', createFakeSource())
    await screen.findByText('Signal gaps today')
    expect(cardValue('Signal gaps today')).toHaveTextContent('0')
    expect(cardValue('Signal gaps today')?.nextSibling).toHaveTextContent('None')
  })

  it('changes the card titles with the range switch', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    await userEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(await screen.findByText('Distance, 7 days')).toBeInTheDocument()
    expect(screen.getByText('Signal gaps, 7 days')).toBeInTheDocument()
    expect(screen.queryByText('Distance today')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '30 days' }))
    expect(await screen.findByText('Distance, 30 days')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByText('Distance today')).toBeInTheDocument()
  })

  it('draws a 7 day chart with the last day labelled Today', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    const chart = screen.getByRole('region', { name: 'Distance per day' })
    expect(within(chart).getByText('Today')).toBeInTheDocument()
    expect(within(chart).getByText('Fri 2')).toBeInTheDocument()
    expect(within(chart).getByTitle('Car 01, 64 km so far')).toBeInTheDocument()
    expect(within(chart).getByTitle('Car 02, 38 km so far')).toBeInTheDocument()
    expect(within(chart).getAllByTitle('Car 01, 0 km')).toHaveLength(6)
  })

  it('builds the hour-by-hour strip and per-car status from live data', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    const strips = screen.getByRole('region', { name: "Today's timeline" })
    expect(await within(strips).findByText('Moving now')).toBeInTheDocument()
    expect(within(strips).getAllByText('No signal')).toHaveLength(2) // legend + Car 02 status
    expect(within(strips).getByText('06:00')).toBeInTheDocument()
    expect(within(strips).getByText('18:00')).toBeInTheDocument()
    expect(within(strips).getAllByTitle(/^Moving /).length).toBeGreaterThan(0)
    expect(within(strips).getAllByTitle(/^No signal /).length).toBeGreaterThan(0)
  })

  it('lists recent trips newest first with notes', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    const rows = within(screen.getByRole('region', { name: 'Recent trips' })).getAllByRole('row').slice(1)
    const text = rows.map((r) => Array.from(r.querySelectorAll('td')).map((td) => td.textContent))
    expect(text).toEqual([
      ['Car 01', 'Town depot → Site', '13:20 – now', '23 km', '58 min', '0', 'In progress'],
      ['Car 02', 'Supplier yard → Site', '12:25 – 13:40', '38 km', '1 h 15 min', '0', 'No signal for 6 min'],
      ['Car 01', 'Site → Town depot', '07:42 – 09:05', '41 km', '1 h 12 min', '2', 'Stopped 11 min in total'],
    ])
  })

  it('shows an em dash, not a misleading 0, for the stops of a trip whose stops are unknown', async () => {
    const unknown = trip(CAR_1.id, localTime(7, 0), localTime(8, 0), { startPlace: null, endPlace: null, stopsKnown: false })
    renderApp('/dashboard', createFakeSource({ trips: [unknown] }))
    await screen.findByText('Distance today')
    const row = within(screen.getByRole('region', { name: 'Recent trips' })).getAllByRole('row')[1]
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent)
    expect(cells.slice(0, 2)).toEqual(['Car 01', 'Away \u2192 away'])
    expect(cells[5]).toBe('\u2014')
  })

  it('shows an empty table when there are no trips', async () => {
    renderApp('/dashboard', createFakeSource())
    expect(await screen.findByText('No trips in this range')).toBeInTheDocument()
    expect(cardValue('Distance today')).toHaveTextContent('0 km')
  })

  it('shows an error when the server cannot be reached', async () => {
    const source = createFakeSource()
    source.getTrips = async () => {
      throw new Error('down')
    }
    renderApp('/dashboard', source)
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(screen.getAllByText("Can't reach the server").length).toBeGreaterThan(0)
  })

  it('shows loading notes first', () => {
    renderApp('/dashboard', createFakeSource())
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('matches Route history: today distance equals the sum of the trips shown for both cars', async () => {
    const source = createTestSource()
    const today = dayBounds(FIXED_NOW)
    const cars = await source.getCars()
    const trips = await source.getTrips(null, today.start, today.end)
    expect(trips.length).toBeGreaterThan(0)

    const total = formatDistance(trips.reduce((s, t) => s + t.distanceM, 0))
    renderApp('/dashboard', source)
    await screen.findByText('Distance today')
    expect(cardValue('Distance today')).toHaveTextContent(total)
    expect(screen.getByRole('region', { name: 'Recent trips' })).toBeInTheDocument()
    document.body.innerHTML = ''

    // Route history for each car, same source and same day.
    for (const car of cars) {
      const mine = trips.filter((t) => t.carId === car.id)
      const { unmount } = renderApp('/history', source)
      await screen.findByText('Thu 8 Oct 2026')
      await userEvent.click(await screen.findByRole('button', { name: car.name }))
      const expected = formatDistance(mine.reduce((s, t) => s + t.distanceM, 0))
      expect(await screen.findByText(new RegExp(`^${mine.length} trips? · ${expected} · `))).toBeInTheDocument()
      unmount()
    }
  })

  it('runs on the mock data source', async () => {
    renderApp('/dashboard')
    expect(await screen.findByText('Distance today')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Recent trips' })).toBeInTheDocument()
  })

  it('stays free of NaN and Infinity with no data at all', async () => {
    renderApp('/dashboard', createFakeSource())
    await screen.findByText('No trips in this range')
    expect(document.body.textContent).not.toMatch(/NaN|Infinity|undefined/)
    const chart = screen.getByRole('region', { name: 'Distance per day' })
    const bars = within(chart).getAllByTitle(/^Car 0\d, 0 km/)
    expect(bars).toHaveLength(14)
    for (const b of bars) expect(b).toHaveStyle({ height: '2px' })
    for (const b of document.querySelectorAll<HTMLElement>('[title]')) expect(b.style.width + b.style.height).not.toMatch(/NaN|Infinity/)
  })
})

/** Trips on other days around the story, with distances that make every range total different. */
function weekScenario() {
  const t = (carId: string, day: number, from: [number, number], to: [number, number], km: number, driveMin: number): Trip =>
    trip(carId, localTime(from[0], from[1], day), localTime(to[0], to[1], day), { distanceM: km * 1000, drivingMs: driveMin * 60_000 })
  const inToday = [t(CAR_2.id, 0, [0, 30], [0, 50], 5, 20)] // local 00:30 is the previous day in UTC
  const inWeek = [
    t(CAR_1.id, -1, [10, 0], [11, 0], 50, 60),
    t(CAR_2.id, -3, [8, 0], [9, 0], 30, 45),
    t(CAR_1.id, -6, [0, 10], [0, 50], 12, 30), // first minutes of the oldest day in "7 days"
  ]
  const inMonth = [
    t(CAR_1.id, -7, [22, 0], [23, 0], 7, 50), // ends 23:00, the evening before that: only in "30 days"
    t(CAR_2.id, -29, [7, 0], [8, 0], 20, 55),
  ]
  const outside = [t(CAR_1.id, -30, [10, 0], [11, 0], 99, 60)]
  return { all: [...inToday, ...inWeek, ...inMonth, ...outside], inToday, inWeek, inMonth }
}

describe('Dashboard range switch', () => {
  useFixedClock()
  const story = [TRIP_A, TRIP_B, TRIP_C]
  const expected = (trips: Trip[]) => ({
    distance: formatDistance(trips.reduce((a, x) => a + x.distanceM, 0)),
    driving: formatDuration(trips.reduce((a, x) => a + x.drivingMs, 0)),
    count: String(trips.length),
  })

  it('changes cards, per-car lines and table with the range; ranges end today and count local days', async () => {
    const w = weekScenario()
    renderApp('/dashboard', dayScenario(w.all))
    await screen.findByText('Distance today')

    const check = async (button: string, suffix: string, trips: Trip[], rows: string[][]) => {
      await userEvent.click(screen.getByRole('button', { name: button }))
      const e = expected(trips)
      expect(await screen.findByText(`Distance${suffix}`)).toBeInTheDocument()
      expect(cardValue(`Distance${suffix}`)).toHaveTextContent(e.distance)
      expect(cardValue(`Driving time${suffix}`)).toHaveTextContent(e.driving)
      expect(cardValue(`Trips${suffix}`)).toHaveTextContent(e.count)
      expect(cardValue(`Trips${suffix}`)?.nextSibling).toHaveTextContent('1 in progress')
      const c1 = Math.round(summarizeTrips(CAR_1.id, trips).distanceM / 1000)
      const c2 = Math.round(summarizeTrips(CAR_2.id, trips).distanceM / 1000)
      expect(cardValue(`Distance${suffix}`)?.nextSibling).toHaveTextContent(`Car 01 ${c1} · Car 02 ${c2}`)
      const table = within(screen.getByRole('region', { name: 'Recent trips' }))
      const text = table.getAllByRole('row').slice(1).map((r) => Array.from(r.querySelectorAll('td')).slice(0, 4).map((td) => td.textContent))
      expect(text).toEqual(rows)
    }

    await check('Today', ' today', [...story, ...w.inToday], [
      ['Car 01', 'Town depot → Site', '13:20 – now', '23 km'],
      ['Car 02', 'Supplier yard → Site', '12:25 – 13:40', '38 km'],
      ['Car 01', 'Site → Town depot', '07:42 – 09:05', '41 km'],
      ['Car 02', 'Origin → Destination', '00:30 – 00:50', '5.0 km'],
    ])
    await check('7 days', ', 7 days', [...story, ...w.inToday, ...w.inWeek], [
      ['Car 01', 'Town depot → Site', 'Thu 8 · 13:20 – now', '23 km'],
      ['Car 02', 'Supplier yard → Site', 'Thu 8 · 12:25 – 13:40', '38 km'],
      ['Car 01', 'Site → Town depot', 'Thu 8 · 07:42 – 09:05', '41 km'],
      ['Car 02', 'Origin → Destination', 'Thu 8 · 00:30 – 00:50', '5.0 km'],
      ['Car 01', 'Origin → Destination', 'Wed 7 · 10:00 – 11:00', '50 km'],
      ['Car 02', 'Origin → Destination', 'Mon 5 · 08:00 – 09:00', '30 km'],
      ['Car 01', 'Origin → Destination', 'Fri 2 · 00:10 – 00:50', '12 km'],
    ])
    await check('30 days', ', 30 days', [...story, ...w.inToday, ...w.inWeek, ...w.inMonth], [
      ['Car 01', 'Town depot → Site', 'Thu 8 · 13:20 – now', '23 km'],
      ['Car 02', 'Supplier yard → Site', 'Thu 8 · 12:25 – 13:40', '38 km'],
      ['Car 01', 'Site → Town depot', 'Thu 8 · 07:42 – 09:05', '41 km'],
      ['Car 02', 'Origin → Destination', 'Thu 8 · 00:30 – 00:50', '5.0 km'],
      ['Car 01', 'Origin → Destination', 'Wed 7 · 10:00 – 11:00', '50 km'],
      ['Car 02', 'Origin → Destination', 'Mon 5 · 08:00 – 09:00', '30 km'],
      ['Car 01', 'Origin → Destination', 'Fri 2 · 00:10 – 00:50', '12 km'],
      ['Car 01', 'Origin → Destination', 'Thu 1 · 22:00 – 23:00', '7.0 km'],
      ['Car 02', 'Origin → Destination', 'Wed 9 · 07:00 – 08:00', '20 km'],
    ])
    await check('Today', ' today', [...story, ...w.inToday], [
      ['Car 01', 'Town depot → Site', '13:20 – now', '23 km'],
      ['Car 02', 'Supplier yard → Site', '12:25 – 13:40', '38 km'],
      ['Car 01', 'Site → Town depot', '07:42 – 09:05', '41 km'],
      ['Car 02', 'Origin → Destination', '00:30 – 00:50', '5.0 km'],
    ])
  })

  it('shows the longest signal gap with its day outside the Today range', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    await userEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(await screen.findByText('Signal gaps, 7 days')).toBeInTheDocument()
    expect(cardValue('Signal gaps, 7 days')).toHaveTextContent('1')
    expect(cardValue('Signal gaps, 7 days')?.nextSibling).toHaveTextContent('Car 02 · 6 min at Thu 8 12:58')
  })

  it('keeps ten rows and says how many trips there are', async () => {
    const many = Array.from({ length: 12 }, (_, i) => trip(CAR_1.id, localTime(6, i * 10, -(i % 5) - 1), localTime(6, i * 10 + 5, -(i % 5) - 1)))
    renderApp('/dashboard', dayScenario(many))
    await screen.findByText('Distance today')
    await userEvent.click(screen.getByRole('button', { name: '7 days' }))
    expect(await screen.findByText('Showing the latest 10 of 15 trips')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Recent trips' })).getAllByRole('row')).toHaveLength(11)
  })

  it('marks the pressed range button', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '30 days' }))
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Dashboard distance chart', () => {
  useFixedClock()
  const days = [
    trip(CAR_1.id, localTime(8, 0, -1), localTime(9, 0, -1), { distanceM: 110_400 }),
    trip(CAR_2.id, localTime(8, 0, -1), localTime(9, 0, -1), { distanceM: 61_000 }),
    trip(CAR_1.id, localTime(8, 0, -3), localTime(9, 0, -3), { distanceM: 6_400 }),
  ]

  it('draws grouped bars scaled to the axis, with thin stubs for empty days and tooltip text', async () => {
    renderApp('/dashboard', dayScenario(days))
    await screen.findByText('Distance today')
    const chart = screen.getByRole('region', { name: 'Distance per day' })
    // Largest value 110.4 km -> ticks 0..120, 180 px plot -> 1.5 px per km.
    const drawing = within(chart).getByTitle('Car 01, 110 km').closest('[aria-hidden="true"]') as HTMLElement
    expect(Array.from(drawing.firstElementChild?.children ?? []).map((x) => x.textContent)).toEqual(['120', '80', '40', '0'])
    expect(within(chart).getByTitle('Car 01, 110 km')).toHaveStyle({ height: '165.6px' })
    expect(within(chart).getByTitle('Car 02, 61 km')).toHaveStyle({ height: '91.5px' })
    expect(within(chart).getByTitle('Car 01, 6.4 km')).toHaveStyle({ height: '9.6px' })
    const zero = within(chart).getAllByTitle('Car 02, 0 km')
    expect(zero.length).toBeGreaterThan(3)
    for (const b of zero) expect(b).toHaveStyle({ height: '2px' })
    // Series differ by colour and by name: the legend names both, and each bar names its car.
    for (const name of ['Car 01', 'Car 02']) expect(within(chart).getAllByText(name).length).toBeGreaterThanOrEqual(2) // legend + table head
    expect(within(chart).getByTitle('Car 01, 110 km')).toHaveStyle({ background: 'var(--blue)' })
    expect(within(chart).getByTitle('Car 02, 61 km')).toHaveStyle({ background: 'var(--blue-light)' })
  })

  it('hides the drawing from screen readers and offers the same numbers as a table', async () => {
    renderApp('/dashboard', dayScenario(days))
    await screen.findByText('Distance today')
    const chart = screen.getByRole('region', { name: 'Distance per day' })
    expect(within(chart).getByTitle('Car 01, 110 km').closest('[aria-hidden="true"]')).not.toBeNull()
    expect(within(chart).queryAllByRole('img')).toHaveLength(0)
    const table = within(chart).getByRole('table', { name: 'Distance driven per day over the last 7 days' })
    const rows = within(table).getAllByRole('row').map((r) => Array.from(r.children).map((c) => c.textContent))
    expect(rows).toEqual([
      ['Day', 'Car 01', 'Car 02'],
      ['Fri 2 Oct 2026', '0 km', '0 km'],
      ['Sat 3 Oct 2026', '0 km', '0 km'],
      ['Sun 4 Oct 2026', '0 km', '0 km'],
      ['Mon 5 Oct 2026', '6.4 km', '0 km'],
      ['Tue 6 Oct 2026', '0 km', '0 km'],
      ['Wed 7 Oct 2026', '110 km', '61 km'],
      ['Thu 8 Oct 2026 (today, so far)', '64 km', '38 km'],
    ])
    expect(within(table).getByRole('rowheader', { name: 'Wed 7 Oct 2026' })).toBeInTheDocument()
  })
})

describe('Dashboard hour-by-hour strips', () => {
  useFixedClock()
  const stripOf = (name: string) => screen.getByRole('img', { name: new RegExp(`^${name} today: `) })
  const widths = (el: HTMLElement) => Array.from(el.children).map((c) => parseFloat((c as HTMLElement).style.width))

  it('describes each strip for screen readers and marks no signal after the last fix, not parked', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    const timeline = screen.getByRole('region', { name: "Today's timeline" })
    await within(timeline).findByText('Moving now')
    expect(stripOf('Car 01')).toHaveAccessibleName(
      'Car 01 today: Parked 06:00 to 07:42, Moving 07:42 to 07:58, Parked 07:58 to 08:01, Moving 08:01 to 08:36, ' +
        'Parked 08:36 to 08:44, Moving 08:44 to 09:05, Parked 09:05 to 13:20, Moving 13:20 to now',
    )
    expect(stripOf('Car 02')).toHaveAccessibleName(
      'Car 02 today: Parked 06:00 to 12:25, Moving 12:25 to 12:58, No signal 12:58 to 13:04, Moving 13:04 to 13:40, No signal 13:40 to now',
    )
    // 06:00 to 14:18 of a 12 hour day.
    for (const name of ['Car 01', 'Car 02']) expect(widths(stripOf(name)).reduce((a, b) => a + b, 0)).toBeCloseTo((498 / 720) * 100, 6)
  })

  it('gives the no signal block a dashed outline and keeps the axis 06:00 to 18:00', async () => {
    renderApp('/dashboard', dayScenario())
    await screen.findByText('Distance today')
    const timeline = screen.getByRole('region', { name: "Today's timeline" })
    await within(timeline).findByText('Moving now')
    const block = within(stripOf('Car 02')).getAllByTitle(/^No signal /)[0]
    expect(block.className).toMatch(/segNosignal/)
    expect(within(timeline).getAllByText(/^\d\d:00$/).map((x) => x.textContent)).toEqual(['06:00', '09:00', '12:00', '15:00', '18:00'])
  })

  it('draws nothing before 06:00 and shows the live status without NaN', async () => {
    vi.setSystemTime(localTime(5, 10))
    const source = createFakeSource({
      positions: [
        position(CAR_1.id, localTime(5, 8), { lat: 1, lon: 1 }),
        position(CAR_2.id, localTime(5, 9), { lat: 2, lon: 2 }),
      ],
    })
    renderApp('/dashboard', source)
    const timeline = screen.getByRole('region', { name: "Today's timeline" })
    expect(await within(timeline).findByText('Parked 2 min')).toBeInTheDocument()
    expect(within(timeline).getByText('Parked 1 min')).toBeInTheDocument()
    for (const name of ['Car 01', 'Car 02']) {
      expect(stripOf(name)).toHaveAccessibleName(`${name} today: nothing to show yet`)
      expect(stripOf(name).children).toHaveLength(0)
    }
    expect(screen.getByText(/^Thu 8 Oct 2026 · as of 05:10$/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('fills the strip to the end after 18:00 and keeps the status text right', async () => {
    vi.setSystemTime(localTime(19, 30))
    const source = createFakeSource({
      positions: [
        position(CAR_1.id, localTime(18, 15), { speedKmh: 40, motion: true, lat: 1, lon: 1 }),
        position(CAR_1.id, localTime(18, 20), { lat: 1, lon: 1 }),
        position(CAR_1.id, localTime(19, 29), { lat: 1, lon: 1 }),
        position(CAR_2.id, localTime(19, 29, 0), { speedKmh: 50, motion: true, lat: 2, lon: 2 }),
      ],
      trips: [trip(CAR_1.id, localTime(17, 0), localTime(18, 20)), trip(CAR_2.id, localTime(17, 30), null)],
    })
    renderApp('/dashboard', source)
    const timeline = screen.getByRole('region', { name: "Today's timeline" })
    expect(await within(timeline).findByText('Parked 1 h 10 min')).toBeInTheDocument()
    expect(within(timeline).getByText('Moving now')).toBeInTheDocument()
    expect(stripOf('Car 01')).toHaveAccessibleName(
      'Car 01 today: Parked 06:00 to 17:00, Moving 17:00 to 18:00',
    )
    expect(stripOf('Car 02')).toHaveAccessibleName('Car 02 today: Parked 06:00 to 17:30, Moving 17:30 to 18:00')
    for (const name of ['Car 01', 'Car 02']) {
      const w = widths(stripOf(name))
      expect(w.every((x) => Number.isFinite(x) && x > 0)).toBe(true)
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6)
    }
  })
})

describe('Dashboard loading and errors', () => {
  useFixedClock()

  it('lets the cards that still have their data show it when only the signal gaps fail', async () => {
    const source = dayScenario()
    source.getRoute = async () => {
      throw new Error('down')
    }
    renderApp('/dashboard', source)
    expect(await screen.findByText('Distance today')).toBeInTheDocument()
    await waitFor(() => expect(within(screen.getByText('Signal gaps today').parentElement as HTMLElement).getByRole('alert')).toBeInTheDocument())
    expect(cardValue('Distance today')).toHaveTextContent('102 km')
    expect(cardValue('Driving time today')).toHaveTextContent('3 h 25 min')
    expect(cardValue('Trips today')).toHaveTextContent('3')
    // The chart does not need the route either.
    const chart = screen.getByRole('region', { name: 'Distance per day' })
    expect(within(chart).getByTitle('Car 01, 64 km so far')).toBeInTheDocument()
  })

  it('shows each section as loading on its own while the data is on its way', () => {
    renderApp('/dashboard', createFakeSource())
    for (const name of ['Distance per day', "Today's timeline", 'Recent trips']) {
      expect(within(screen.getByRole('region', { name })).getByRole('status')).toBeInTheDocument()
    }
    for (const label of ['Distance today', 'Driving time today', 'Trips today', 'Signal gaps today']) {
      expect(within(screen.getByText(label).parentElement as HTMLElement).getByRole('status')).toBeInTheDocument()
    }
  })

  it('shows the error in every section when the cars cannot be loaded', async () => {
    const source = createFakeSource()
    source.getCars = async () => {
      throw new Error('down')
    }
    renderApp('/dashboard', source)
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(7))
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })
})

describe('Dashboard matches Route history and the data source', () => {
  useFixedClock()

  it('has the same totals as the source summary for every range', async () => {
    const source = createTestSource()
    renderApp('/dashboard', source)
    await screen.findByText('Distance today')
    const today = dayBounds(FIXED_NOW)
    for (const [button, suffix, days] of [
      ['Today', ' today', 1],
      ['7 days', ', 7 days', 7],
      ['30 days', ', 30 days', 30],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name: button }))
      await screen.findByText(`Distance${suffix}`)
      await waitFor(() => expect(screen.queryAllByRole('status')).toHaveLength(0))
      const rows = await source.getSummary(addDays(today.start, 1 - days), today.end)
      expect(cardValue(`Distance${suffix}`)).toHaveTextContent(formatDistance(rows.reduce((s, r) => s + r.distanceM, 0)))
      expect(cardValue(`Driving time${suffix}`)).toHaveTextContent(formatDuration(rows.reduce((s, r) => s + r.drivingMs, 0)))
      expect(cardValue(`Trips${suffix}`)).toHaveTextContent(String(rows.reduce((s, r) => s + r.tripCount, 0)))
    }
  })

  it('has chart values that equal the trips Route history shows for each of the last 7 days', async () => {
    const source = createTestSource()
    const cars = await source.getCars()
    renderApp('/dashboard', source)
    await screen.findByText('Distance today')
    const table = await screen.findByRole('table', { name: 'Distance driven per day over the last 7 days' })
    const today = dayBounds(FIXED_NOW).start
    const body = within(table).getAllByRole('row').slice(1)
    expect(body).toHaveLength(7)
    for (let i = 0; i < 7; i++) {
      const day = addDays(today, i - 6)
      const cells = Array.from(body[i].querySelectorAll('td')).map((td) => td.textContent)
      const expected = await Promise.all(
        cars.map(async (c) => formatDistance(summarizeTrips(c.id, await source.getTrips(c.id, day, addDays(day, 1))).distanceM)),
      )
      expect(cells).toEqual(expected)
    }
  })
})
