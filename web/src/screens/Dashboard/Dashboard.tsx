import { useId, useState } from 'react'
import { AsyncNotice, EmptyNotice } from '../../components/ui/AsyncNotice'
import { blockedBy } from '../../components/ui/blockedBy'
import { Card } from '../../components/ui/Card'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { config } from '../../config'
import { buildHourStrip, describeStrip, distancePerDay, openSignalGap, summarizeTrips } from '../../data/derive'
import {
  addDays,
  dayBounds,
  formatClock,
  formatDayLabel,
  formatDistance,
  formatDuration,
  formatHm,
  formatKmValue,
  formatShortDay,
} from '../../data/format'
import { useCars, useLiveCars, useNow, useSignalGaps, useTrips, type Async } from '../../data/hooks'
import type { Car, LiveCar, SignalGap, Summary, Trip } from '../../data/types'
import { stopsCount, totalStopMs, tripTimeRange, tripTitle } from '../shared/tripText'
import { chartAxis } from './chartAxis'
import styles from './Dashboard.module.css'

type Range = 'today' | '7d' | '30d'

const RANGE_DAYS: Record<Range, number> = { today: 1, '7d': 7, '30d': 30 }
const RANGE_SUFFIX: Record<Range, string> = { today: ' today', '7d': ', 7 days', '30d': ', 30 days' }
const SERIES_COLORS = ['var(--blue)', 'var(--blue-light)']
const CHART_DAYS = 7
const PLOT_PX = 180 // height of .plot in the CSS module
const ZERO_BAR_PX = 2
const TABLE_ROWS = 10
const AXIS_STEP_H = 3

const segClass = {
  moving: styles.segMoving,
  parked: styles.segParked,
  nosignal: styles.segNosignal,
} as const

const byCar = (trips: Trip[], carId: string) => trips.filter((t) => t.carId === carId)
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

/** Two loads as one: the first failure, else loading, else both results. Lets a section wait on only what it needs. */
function join<A, B>(a: Async<A>, b: Async<B>): Async<[A, B]> {
  const blocked = blockedBy(a, b)
  if (blocked) return blocked
  return a.status === 'ready' && b.status === 'ready' ? { status: 'ready', data: [a.data, b.data] } : { status: 'loading' }
}

interface Totals {
  distanceM: number
  drivingMs: number
  tripCount: number
  inProgress: number
  perCar: Summary[]
}

function totalsOf(cars: Car[], trips: Trip[]): Totals {
  // summarizeTrips is the single source of truth shared with Route history.
  const perCar = cars.map((c) => summarizeTrips(c.id, byCar(trips, c.id)))
  return {
    distanceM: perCar.reduce((s, x) => s + x.distanceM, 0),
    drivingMs: perCar.reduce((s, x) => s + x.drivingMs, 0),
    tripCount: perCar.reduce((s, x) => s + x.tripCount, 0),
    inProgress: perCar.reduce((s, x) => s + x.inProgressCount, 0),
    perCar,
  }
}

function longestGapText(cars: Car[], gaps: SignalGap[], range: Range): string {
  if (gaps.length === 0) return 'None'
  const g = gaps.reduce((a, b) => (b.durationMs > a.durationMs ? b : a))
  const name = cars.find((c) => c.id === g.carId)?.name ?? 'A car'
  const when = range === 'today' ? formatClock(g.startTime) : `${formatShortDay(g.startTime)} ${formatClock(g.startTime)}`
  return `${name} · ${formatDuration(g.durationMs)} at ${when}`
}

/** One stat card. It shows its own loading or error note, so a failure in one load leaves the other cards alone. */
function Stat<T>(props: { label: string; hero?: boolean; state: Async<T>; show: (data: T) => { value: string; detail: string } }) {
  const { label, hero, state, show } = props
  const text = state.status === 'ready' ? show(state.data) : null
  return (
    <Card className={`${styles.stat} ${hero ? styles.statHero : ''}`}>
      <div className={styles.statLabel}>{label}</div>
      {text ? (
        <>
          <div className={styles.statValue}>{text.value}</div>
          <div className={styles.statDetail}>{text.detail}</div>
        </>
      ) : (
        <AsyncNotice state={state as Async<never>} loading="Loading..." />
      )}
    </Card>
  )
}

function StatCards({ range, cars, trips, gaps }: { range: Range; cars: Async<Car[]>; trips: Async<Trip[]>; gaps: Async<SignalGap[]> }) {
  const suffix = RANGE_SUFFIX[range]
  const tripState = join(cars, trips)
  const perCar = (t: Totals, carList: Car[], f: (s: Summary) => string) => carList.map((c, i) => `${c.name} ${f(t.perCar[i])}`).join(' · ')
  return (
    <>
      <Stat
        label={`Distance${suffix}`}
        hero
        state={tripState}
        show={([c, tr]) => {
          const t = totalsOf(c, tr)
          return { value: formatDistance(t.distanceM), detail: perCar(t, c, (s) => formatKmValue(s.distanceM)) }
        }}
      />
      <Stat
        label={`Driving time${suffix}`}
        state={tripState}
        show={([c, tr]) => {
          const t = totalsOf(c, tr)
          return { value: formatDuration(t.drivingMs), detail: perCar(t, c, (s) => formatHm(s.drivingMs)) }
        }}
      />
      <Stat
        label={`Trips${suffix}`}
        state={tripState}
        show={([c, tr]) => {
          const t = totalsOf(c, tr)
          return { value: String(t.tripCount), detail: t.inProgress > 0 ? `${t.inProgress} in progress` : 'None in progress' }
        }}
      />
      <Stat
        label={`Signal gaps${suffix}`}
        state={join(cars, gaps)}
        show={([c, g]) => ({ value: String(g.length), detail: longestGapText(c, g, range) })}
      />
    </>
  )
}

function Bar({ meters, pxPerKm, color, title }: { meters: number; pxPerKm: number; color: string; title: string }) {
  const zero = !(meters > 0)
  const height = zero ? ZERO_BAR_PX : Math.max(ZERO_BAR_PX, Math.round((meters / 1000) * pxPerKm * 100) / 100)
  return <div title={title} className={`${styles.bar} ${zero ? styles.barZero : ''}`} style={{ height, background: color }} />
}

function DistanceChart({ cars, trips, todayStart }: { cars: Async<Car[]>; trips: Async<Trip[]>; todayStart: number }) {
  const state = join(cars, trips)
  return (
    <Card as="section" ariaLabel="Distance per day" className={styles.chartCard}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Distance per day, km</h2>
        {cars.status === 'ready' && (
          <div className={styles.legend}>
            {cars.data.map((c, i) => (
              <div key={c.id} className={styles.legendItem}>
                <span className={styles.swatch} style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden="true" />
                {c.name}
              </div>
            ))}
          </div>
        )}
      </div>
      {state.status === 'ready' ? (
        <ChartPlot cars={state.data[0]} trips={state.data[1]} todayStart={todayStart} />
      ) : (
        <AsyncNotice state={state as Async<never>} loading="Loading chart..." />
      )}
    </Card>
  )
}

function ChartPlot({ cars, trips, todayStart }: { cars: Car[]; trips: Trip[]; todayStart: number }) {
  const dayStarts = Array.from({ length: CHART_DAYS }, (_, i) => addDays(todayStart, i - (CHART_DAYS - 1)))
  const series = cars.map((c) => distancePerDay(byCar(trips, c.id), dayStarts))
  const axis = chartAxis(Math.max(0, ...series.flat()) / 1000)
  const pxPerKm = PLOT_PX / axis.max
  const dayName = (d: number) => (d === todayStart ? `${formatDayLabel(d)} (today, so far)` : formatDayLabel(d))

  return (
    <>
      {/* The drawing is for the eyes; the table below carries the same numbers for screen readers. */}
      <div className={styles.chart} aria-hidden="true">
        <div className={styles.yAxis}>
          {axis.ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className={styles.plotWrap}>
          <div className={styles.plot}>
            <div className={styles.bars}>
              {dayStarts.map((d, di) => {
                const suffix = d === todayStart ? ' so far' : ''
                return (
                  <div key={d} className={styles.barGroup}>
                    {cars.map((c, ci) => (
                      <Bar
                        key={c.id}
                        meters={series[ci][di]}
                        pxPerKm={pxPerKm}
                        color={SERIES_COLORS[ci % SERIES_COLORS.length]}
                        title={`${c.name}, ${formatDistance(series[ci][di])}${suffix}`}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
          <div className={styles.xAxis}>
            {dayStarts.map((d) => (
              <span key={d} className={d === todayStart ? styles.xToday : undefined}>
                {d === todayStart ? 'Today' : formatShortDay(d)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.srOnly}>
        <table>
          <caption>Distance driven per day over the last {CHART_DAYS} days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {cars.map((c) => (
                <th key={c.id} scope="col">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dayStarts.map((d, di) => (
              <tr key={d}>
                <th scope="row">{dayName(d)}</th>
                {cars.map((c, ci) => (
                  <td key={c.id}>{formatDistance(series[ci][di])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function liveStatusText(live: LiveCar | undefined): { text: string; color: string } | null {
  if (!live) return null
  if (live.status === 'moving') return { text: 'Moving now', color: 'var(--blue)' }
  if (live.status === 'parked') {
    return { text: live.parkedForMs === null ? 'Parked' : `Parked ${formatDuration(live.parkedForMs)}`, color: 'var(--orange)' }
  }
  return { text: 'No signal', color: 'var(--muted)' }
}

function HourStrips(props: {
  cars: Async<Car[]>
  trips: Async<Trip[]>
  gaps: Async<SignalGap[]>
  live: Async<LiveCar[]>
  todayStart: number
  todayEnd: number
  now: number
}) {
  const { cars, trips, gaps, live, todayStart, todayEnd, now } = props
  const state = join(join(cars, trips), gaps)
  const axis: string[] = []
  for (let h = config.workdayStartHour; h <= config.workdayEndHour; h += AXIS_STEP_H) axis.push(hourLabel(h))

  return (
    <Card as="section" ariaLabel="Today's timeline" className={styles.chartCard}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>Today, hour by hour</h2>
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: 'var(--blue)' }} aria-hidden="true" />
            Moving
          </div>
          <div className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: 'var(--orange-light)' }} aria-hidden="true" />
            Parked
          </div>
          <div className={styles.legendItem}>
            <span className={`${styles.swatch} ${styles.swatchDashed}`} aria-hidden="true" />
            No signal
          </div>
        </div>
      </div>

      {state.status !== 'ready' && <AsyncNotice state={state as Async<never>} loading="Loading timeline..." />}
      {state.status === 'ready' &&
        state.data[0][0].map((c) => {
          const liveCar = live.status === 'ready' ? live.data.find((l) => l.car.id === c.id) : undefined
          // A car with no signal right now has an open "no fix since" tail that is not in the gap list.
          const open = liveCar ? openSignalGap(c.id, liveCar.position, now) : null
          const segments = buildHourStrip({
            dayStart: todayStart,
            now,
            trips: byCar(state.data[0][1], c.id).filter((t) => t.startTime < todayEnd && (t.endTime ?? now) > todayStart),
            gaps: [...state.data[1].filter((g) => g.carId === c.id), ...(open ? [open] : [])],
          })
          const status = liveStatusText(liveCar)
          return (
            <div key={c.id} className={styles.stripBlock}>
              <div className={styles.stripHead}>
                <span className={styles.stripName}>{c.name}</span>
                {status && <span style={{ color: status.color, fontWeight: 700 }}>{status.text}</span>}
              </div>
              <div className={styles.strip} role="img" aria-label={`${c.name} today: ${describeStrip(segments, now)}`}>
                {segments.map((seg, i) => (
                  <div key={i} title={seg.title} className={segClass[seg.kind]} style={{ width: `${seg.widthPct}%` }} />
                ))}
              </div>
            </div>
          )
        })}

      <div className={styles.hours} aria-hidden="true">
        {axis.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </Card>
  )
}

function notesOf(t: Trip, gaps: SignalGap[], now: number): string[] {
  const notes: string[] = []
  if (t.endTime === null) notes.push('In progress')
  const end = t.endTime ?? now
  const inside = gaps.filter((g) => g.carId === t.carId && g.startTime < end && g.endTime > t.startTime)
  if (inside.length > 0) notes.push(`No signal for ${formatDuration(inside.reduce((s, g) => s + g.durationMs, 0))}`)
  if (t.stops.length > 0) notes.push(`Stopped ${formatDuration(totalStopMs(t))} in total`)
  return notes
}

function TripsTable(props: { range: Range; cars: Async<Car[]>; trips: Async<Trip[]>; gaps: Async<SignalGap[]>; now: number }) {
  const { range, cars, trips, gaps, now } = props
  const titleId = useId()
  const state = join(join(cars, trips), gaps)
  const ready = state.status === 'ready' ? state.data : null
  const all = ready ? [...ready[0][1]].sort((a, b) => b.startTime - a.startTime) : []
  const rows = all.slice(0, TABLE_ROWS)

  return (
    <Card as="section" ariaLabel="Recent trips" className={styles.tableCard}>
      <h2 id={titleId} className={styles.cardTitle}>
        Recent trips
      </h2>
      {state.status !== 'ready' && <AsyncNotice state={state as Async<never>} loading="Loading trips..." />}
      {ready && rows.length === 0 && <EmptyNotice>No trips in this range</EmptyNotice>}
      {ready && rows.length > 0 && (
        <>
          {/* Focusable so the sideways scroll works from the keyboard. */}
          <div className={styles.scroll} role="region" aria-label="Trips table" tabIndex={0}>
            <table className={styles.table} aria-labelledby={titleId}>
              <thead>
                <tr>
                  <th scope="col">Car</th>
                  <th scope="col">Route</th>
                  <th scope="col">Time</th>
                  <th scope="col" className={styles.num}>Distance</th>
                  <th scope="col" className={styles.num}>Driving</th>
                  <th scope="col" className={styles.num}>Stops</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.carCell}>{ready[0][0].find((c) => c.id === r.carId)?.name ?? r.carId}</td>
                    <td>{tripTitle(r)}</td>
                    <td className={styles.monoCell}>{tripTimeRange(r, range !== 'today')}</td>
                    <td className={`${styles.monoCell} ${styles.num}`}>{formatDistance(r.distanceM)}</td>
                    <td className={`${styles.monoCell} ${styles.num}`}>{formatDuration(r.drivingMs)}</td>
                    <td className={`${styles.monoCell} ${styles.num}`}>{stopsCount(r)}</td>
                    <td className={r.endTime === null ? styles.noteLive : styles.notePlain}>{notesOf(r, ready[1], now).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {all.length > rows.length && (
            <div className={styles.tableNote}>
              Showing the latest {rows.length} of {all.length} trips
            </div>
          )}
        </>
      )}
    </Card>
  )
}

export function Dashboard() {
  const [range, setRange] = useState<Range>('today')
  const now = useNow()
  const today = dayBounds(now)
  const rangeFrom = addDays(today.start, 1 - RANGE_DAYS[range])
  const weekFrom = addDays(today.start, 1 - CHART_DAYS)

  const cars = useCars()
  const live = useLiveCars()
  const rangeTrips = useTrips(null, rangeFrom, today.end)
  const rangeGaps = useSignalGaps(null, rangeFrom, today.end)
  const weekTrips = useTrips(null, weekFrom, today.end)
  const todayGaps = useSignalGaps(null, today.start, today.end)

  return (
    <main className={styles.main}>
      <div className={styles.top}>
        <div>
          <h1>Dashboard</h1>
          <div className={styles.date}>
            {formatDayLabel(now)} · as of {formatClock(now)}
          </div>
        </div>
        <SegmentedControl
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: 'today', label: 'Today' },
            { value: '7d', label: '7 days' },
            { value: '30d', label: '30 days' },
          ]}
        />
      </div>

      <section aria-label="Totals" className={styles.stats}>
        <StatCards range={range} cars={cars} trips={rangeTrips} gaps={rangeGaps} />
      </section>

      <div className={styles.row}>
        <DistanceChart cars={cars} trips={weekTrips} todayStart={today.start} />
        <HourStrips cars={cars} trips={weekTrips} gaps={todayGaps} live={live} todayStart={today.start} todayEnd={today.end} now={now} />
      </div>

      <TripsTable range={range} cars={cars} trips={rangeTrips} gaps={rangeGaps} now={now} />
    </main>
  )
}
