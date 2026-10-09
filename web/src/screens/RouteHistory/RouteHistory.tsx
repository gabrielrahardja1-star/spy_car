import { useRef, useState } from 'react'
import type { HistoryMapHandle } from '../../components/map/HistoryMapView'
import { stopTicks } from '../../components/map/playback'
import { AsyncNotice, EmptyNotice } from '../../components/ui/AsyncNotice'
import { blockedBy } from '../../components/ui/blockedBy'
import { IconButton } from '../../components/ui/Buttons'
import { Card } from '../../components/ui/Card'
import { ModeToggle, ViewControls, type MapMode } from '../../components/ui/MapOverlays'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { StatTile } from '../../components/ui/StatTile'
import { summarizeTrips } from '../../data/derive'
import type { Car, Geofence, Position, Trip } from '../../data/types'
import { addDays, dayBounds, formatClock, formatDayLabel, formatDistance, formatDuration } from '../../data/format'
import { useCars, useGeofences, useNow, useTrips, type Async } from '../../data/hooks'
import { eventsOf, type TimelineEvent } from './events'
import split from '../split.module.css'
import { stopsSummary, tripAddressLine, tripCountText, tripTimeRange, tripTitle } from '../shared/tripText'
import { PlaybackBar } from './PlaybackBar'
import styles from './RouteHistory.module.css'
import { TripMap } from './TripMap'
import { usePlayback } from './usePlayback'
import { useTripRoute } from './useTripRoute'

// Stable empties, so memoised map props do not change on every render while there is no data.
const NO_FIXES: Position[] = []
const NO_GEOFENCES: Geofence[] = []

const eventColor: Record<TimelineEvent['kind'], { color: string; shape: string }> = {
  move: { color: 'var(--blue)', shape: styles.markerRound },
  stop: { color: 'var(--orange)', shape: styles.markerSquare },
  end: { color: 'var(--ink)', shape: styles.markerRound },
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

interface TripCardProps {
  trip: Trip
  geofences: Geofence[]
  selected: boolean
  /** Timeline rows jump the replay to their time; off while there is no route to replay. */
  canSeek: boolean
  onSelect: () => void
  onSeek: (time: number) => void
}

function TripCard({ trip, geofences, selected, canSeek, onSelect, onSeek }: TripCardProps) {
  const inProgress = trip.endTime === null
  const showDetail = selected && !inProgress
  return (
    <div role="group" aria-label={tripTitle(trip)}>
      {/* The card's padding lives on its buttons, so the whole card is the click target. */}
      <Card selected={selected} accent="var(--blue)" className={styles.trip} style={{ padding: 0 }}>
        <button
          type="button"
          className={`${styles.tripButton} ${selected ? styles.tripButtonSelected : ''} ${showDetail ? styles.tripButtonOpen : ''}`}
          aria-pressed={selected}
          onClick={onSelect}
        >
          <span className={styles.tripHead}>
            <span className={styles.tripTitle}>{tripTitle(trip)}</span>
            <span className={styles.tripTime}>{tripTimeRange(trip)}</span>
          </span>
          {tripAddressLine(trip) && <span className={styles.tripAddress}>{tripAddressLine(trip)}</span>}
          {inProgress && (
            <span className={styles.progress}>
              <span className={styles.progressDot} aria-hidden="true" />
              In progress · {formatDistance(trip.distanceM)} so far
            </span>
          )}
        </button>
        {showDetail && (
          <div className={styles.detail}>
            <div className={styles.tiles}>
              <StatTile label="Distance" value={formatDistance(trip.distanceM)} />
              <StatTile label="Driving" value={formatDuration(trip.drivingMs)} />
              <StatTile label="Stops" value={stopsSummary(trip)} />
            </div>
            <ul className={styles.events}>
              {eventsOf(trip, geofences).map((e, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={styles.event}
                    style={{ color: eventColor[e.kind].color }}
                    disabled={!canSeek}
                    aria-label={`Go to ${formatClock(e.time)}, ${e.text}`}
                    onClick={() => onSeek(e.time)}
                  >
                    <span className={`${styles.marker} ${eventColor[e.kind].shape}`} aria-hidden="true" />
                    <span className={styles.eventTime}>{formatClock(e.time)}</span>
                    <span style={{ color: 'var(--ink)' }}>{e.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  )
}

/** Why the map has no route to show right now, or null when it has one. */
function mapNotice(trips: Async<Trip[]>, trip: Trip | null, route: Async<Position[]>): string | null {
  if (trips.status === 'loading') return 'Loading route...'
  if (trips.status === 'error') return "Can't load routes"
  if (!trip) return 'No route to show on this day'
  if (route.status === 'loading') return 'Loading route...'
  if (route.status === 'error') return "Can't load this route"
  return route.data.length === 0 ? 'No route points for this trip' : null
}

function HistoryBody({ cars }: { cars: Car[] }) {
  const now = useNow()
  const geofences = useGeofences()
  const [pickedCar, setPickedCar] = useState<string | null>(null)
  const [pickedDay, setPickedDay] = useState<number | null>(null) // null = today
  const [pickedTrip, setPickedTrip] = useState<string | null>(null)

  const car = cars.find((c) => c.id === pickedCar) ?? cars[0]
  const todayStart = dayBounds(now).start
  const dayStart = pickedDay ?? todayStart
  const isToday = dayStart === todayStart
  const dayEnd = dayBounds(dayStart).end

  const tripsAsync = useTrips(car.id, dayStart, dayEnd)
  // The data layer returns newest first; the design lists a day oldest first.
  const trips = tripsAsync.status === 'ready' ? [...tripsAsync.data].sort((a, b) => a.startTime - b.startTime) : []
  // Derived, so a day or car change falls back to the first trip without an effect.
  const selectedTrip = trips.find((t) => t.id === pickedTrip) ?? trips[0] ?? null
  const carIndex = Math.max(0, cars.indexOf(car))
  const summary = tripsAsync.status === 'ready' ? summarizeTrips(car.id, tripsAsync.data) : null
  const fences = geofences.status === 'ready' ? geofences.data : NO_GEOFENCES

  const routeAsync = useTripRoute(selectedTrip)
  const fixes = routeAsync.status === 'ready' ? routeAsync.data : NO_FIXES
  const playback = usePlayback(selectedTrip, fixes)
  const [mode, setMode] = useState<MapMode>('3d')
  const mapRef = useRef<HistoryMapHandle>(null)
  const notice = mapNotice(tripsAsync, selectedTrip, routeAsync)

  const goDay = (delta: number) => {
    const next = addDays(dayStart, delta)
    setPickedDay(next >= todayStart ? null : next)
    setPickedTrip(null)
  }
  const blocked = blockedBy(tripsAsync)

  return (
    <main className={split.main}>
      <section aria-label="Trips" className={split.panel}>
        <h1 className={split.title}>Route history</h1>

        <SegmentedControl
          label="Car"
          fill
          value={car.id}
          onChange={(id) => {
            setPickedCar(id)
            setPickedTrip(null)
          }}
          options={cars.map((c) => ({ value: c.id, label: c.name }))}
        />

        <div className={styles.dayPicker}>
          <IconButton aria-label="Previous day" onClick={() => goDay(-1)}>
            <Chevron dir="left" />
          </IconButton>
          <div className={styles.dayText}>
            <div className={styles.dayLabel}>{formatDayLabel(dayStart)}</div>
            <div className={styles.daySummary}>
              {summary
                ? `${tripCountText(summary.tripCount)} · ${formatDistance(summary.distanceM)} · ${formatDuration(summary.drivingMs)} driving`
                : ' '}
            </div>
          </div>
          {/* Disabled on today: there is no later day to show. */}
          <IconButton aria-label="Next day" disabled={isToday} onClick={() => goDay(1)}>
            <Chevron dir="right" />
          </IconButton>
        </div>

        {blocked && <AsyncNotice state={blocked} loading="Loading trips..." />}
        {tripsAsync.status === 'ready' && trips.length === 0 && <EmptyNotice>No trips on this day</EmptyNotice>}
        {trips.map((trip) => (
          <TripCard
            key={trip.id}
            trip={trip}
            geofences={fences}
            selected={selectedTrip?.id === trip.id}
            canSeek={playback.enabled}
            onSelect={() => setPickedTrip(trip.id)}
            onSeek={playback.seek}
          />
        ))}
      </section>

      <section aria-label="Route map" className={split.map}>
        <TripMap
          trip={selectedTrip}
          car={car}
          carIndex={carIndex}
          fixes={fixes}
          time={playback.time}
          geofences={fences}
          mode={mode}
          mapRef={mapRef}
        />
        {notice && (
          <div className={styles.mapNotice} role="status">
            {notice}
          </div>
        )}
        <div className={styles.overlays}>
          <div className={styles.controls}>
            <ModeToggle inline mode={mode} onChange={setMode} />
            <ViewControls
              inline
              fitLabel="Fit route"
              onFit={() => mapRef.current?.fitRoute()}
              onZoomIn={() => mapRef.current?.zoomBy(1)}
              onZoomOut={() => mapRef.current?.zoomBy(-1)}
            />
          </div>
          <PlaybackBar
            disabled={!playback.enabled}
            playing={playback.playing}
            speed={playback.speed}
            time={playback.time}
            fraction={playback.fraction}
            start={playback.span?.start ?? null}
            end={selectedTrip?.endTime ?? null}
            ticks={selectedTrip ? stopTicks(selectedTrip, playback.span?.end) : []}
            onToggle={playback.toggle}
            onSeek={(f) => playback.span && playback.seek(playback.span.start + (playback.span.end - playback.span.start) * f)}
            onCycleSpeed={playback.cycleSpeed}
          />
        </div>
      </section>
    </main>
  )
}

export function RouteHistory() {
  const cars = useCars()
  if (cars.status !== 'ready' || cars.data.length === 0) {
    return (
      <main className={split.main}>
        <section aria-label="Trips" className={split.panel}>
          <h1 className={split.title}>Route history</h1>
          {cars.status === 'ready' ? (
            <EmptyNotice>No cars set up</EmptyNotice>
          ) : (
            <AsyncNotice state={cars} loading="Loading cars..." />
          )}
        </section>
      </main>
    )
  }
  return <HistoryBody cars={cars.data} />
}
