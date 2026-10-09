import { useMemo, useRef, useState } from 'react'
import { LiveMapSurface } from '../../components/map/LiveMapSurface'
import type { MapHandle } from '../../components/map/LiveMapView'
import type { MapPin } from '../../components/map/mapGeometry'
import { AsyncNotice } from '../../components/ui/AsyncNotice'
import { blockedBy } from '../../components/ui/blockedBy'
import { Card } from '../../components/ui/Card'
import { Legend, ModeToggle, ViewControls, type MapMode } from '../../components/ui/MapOverlays'
import { StatTile } from '../../components/ui/StatTile'
import { StatusPill } from '../../components/ui/StatusPill'
import { dayBounds, formatClock, formatDistance } from '../../data/format'
import { useGeofences, useLiveCars, useNow, useTrips } from '../../data/hooks'
import { summarizeTrips } from '../../data/derive'
import type { Geofence, LiveCar } from '../../data/types'
import split from '../split.module.css'
import styles from './LiveMap.module.css'
import { NO_VALUE, contextOf, lastSeenText, parkedForText, pinDetail, speedText, type ContextIcon } from './liveText'
import { useSelectedCar } from './useSelectedCar'
import { useTrail } from './useTrail'

// The first car uses the red icon tile, the second the dark one (design).
const iconTiles = [
  { bg: 'var(--car-red)', stroke: '#FFFFFF' },
  { bg: 'var(--ink)', stroke: 'var(--bg)' },
]

const accents = { moving: 'var(--blue)', parked: 'var(--orange)', nosignal: 'var(--muted)' } as const

function CarIcon({ index }: { index: number }) {
  const t = iconTiles[index % iconTiles.length]
  return (
    <div className={styles.carIcon} style={{ background: t.bg }}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={t.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 13l2-5.5A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5L21 13v5h-3v-2H6v2H3z" />
        <circle cx="7.5" cy="13.5" r="1" />
        <circle cx="16.5" cy="13.5" r="1" />
      </svg>
    </div>
  )
}

function ContextGlyph({ kind }: { kind: ContextIcon }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'arrow' && <path d="M5 12h14M13 6l6 6-6 6" />}
      {kind === 'pin' && (
        <>
          <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      )}
      {kind === 'clock' && (
        <>
          <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
          <path d="M12 7v5l3 2" />
        </>
      )}
    </svg>
  )
}

interface CarCardProps {
  live: LiveCar
  index: number
  geofences: Geofence[]
  now: number
  today: { start: number; end: number }
  selected: boolean
  onSelect: () => void
}

function CarCard({ live, index, geofences, now, today, selected, onSelect }: CarCardProps) {
  const trips = useTrips(live.car.id, today.start, today.end)
  const todayKm = trips.status === 'ready' ? formatDistance(summarizeTrips(live.car.id, trips.data).distanceM) : NO_VALUE
  const context =
    trips.status === 'ready' ? contextOf({ live, trips: trips.data, geofences, now, todayStart: today.start }) : null

  return (
    <button type="button" className={styles.carButton} aria-pressed={selected} onClick={onSelect}>
      <Card selected={selected} accent={accents[live.status]} className={styles.carCard}>
        <div className={styles.carHead}>
          <CarIcon index={index} />
          <div className={styles.carText}>
            <div className={styles.carName}>{live.car.name}</div>
            {live.car.driver !== '' && <div className={styles.driver}>{live.car.driver}</div>}
          </div>
          <StatusPill status={live.status} />
        </div>
        <div className={styles.tiles}>
          {live.status === 'moving' && <StatTile label="Speed" value={speedText(live)} />}
          {live.status === 'parked' && <StatTile label="Parked for" value={parkedForText(live)} />}
          <StatTile label="Last seen" value={lastSeenText(live)} emphasis={live.status === 'nosignal'} />
          {live.status === 'nosignal' && (
            <StatTile label="Last fix" value={live.position ? formatClock(live.position.fixTime) : NO_VALUE} />
          )}
          <StatTile label="Today" value={todayKm} />
        </div>
        {context && (
          <div className={styles.context}>
            <ContextGlyph kind={context.icon} />
            <span>{context.text}</span>
          </div>
        )}
      </Card>
    </button>
  )
}

function summaryText(cars: LiveCar[]): string {
  const count = (s: LiveCar['status']) => cars.filter((c) => c.status === s).length
  const noSignal = count('nosignal')
  return `${count('moving')} moving · ${count('parked')} parked${noSignal > 0 ? ` · ${noSignal} no signal` : ''}`
}

export function LiveMap() {
  const live = useLiveCars()
  const geofences = useGeofences()
  const now = useNow()
  const today = dayBounds(now)
  const [mode, setMode] = useState<MapMode>('3d')
  const cars = live.status === 'ready' ? live.data : []
  const [selected, setSelected] = useSelectedCar(cars.map((c) => c.car.id))
  const fences = geofences.status === 'ready' ? geofences.data : []

  const mapRef = useRef<MapHandle>(null)
  const trail = useTrail(cars.find((c) => c.car.id === selected), today.start, today.end)
  const pins = useMemo<MapPin[]>(
    () =>
      cars.map((c, index) => ({
        id: c.car.id,
        index,
        name: c.car.name,
        status: c.status,
        detail: pinDetail(c),
        position: c.position ? [c.position.lon, c.position.lat] : null,
        fixTime: c.position?.fixTime ?? null,
        course: c.position?.course ?? null,
      })),
    // `live` changes identity every second, which is exactly when the callout ages need refreshing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live],
  )
  const blocked = blockedBy(live)

  return (
    <main className={split.main}>
      <section aria-label="Cars" className={split.panel}>
        <div className={styles.heading}>
          <h1>Cars</h1>
          {live.status === 'ready' && <div className={styles.summary}>{summaryText(live.data)}</div>}
        </div>
        {blocked && <AsyncNotice state={blocked} loading="Loading cars..." />}
        {cars.map((c, i) => (
          <CarCard
            key={c.car.id}
            live={c}
            index={i}
            geofences={fences}
            now={now}
            today={today}
            selected={selected === c.car.id}
            onSelect={() => setSelected(c.car.id)}
          />
        ))}
      </section>

      <section aria-label="Map" className={split.map}>
        <LiveMapSurface
          ref={mapRef}
          pins={pins}
          selectedId={selected}
          geofences={fences}
          trail={trail}
          mode={mode}
          onSelect={setSelected}
          siteName={fences.find((g) => g.kind === 'site')?.name}
          originName={fences.find((g) => g.kind === 'place')?.name}
        />
        <Legend />
        <ModeToggle mode={mode} onChange={setMode} />
        <ViewControls
          onFit={() => mapRef.current?.fitCars()}
          onZoomIn={() => mapRef.current?.zoomBy(1)}
          onZoomOut={() => mapRef.current?.zoomBy(-1)}
        />
      </section>
    </main>
  )
}
