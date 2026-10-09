import { useMemo, type Ref } from 'react'
import { HistoryMapSurface } from '../../components/map/HistoryMapSurface'
import type { HistoryCar, HistoryMapHandle, TripMarker } from '../../components/map/HistoryMapView'
import type { HistoryOverlay } from '../../components/map/MapPlaceholder'
import { centroid, type LngLat } from '../../components/map/mapGeometry'
import { distanceAlong, drivenCoordinates, positionAt, routeCoordinates } from '../../components/map/playback'
import type { MapMode } from '../../components/ui/MapOverlays'
import { formatClock, formatDistance, formatDuration } from '../../data/format'
import type { Car, Geofence, Position, Trip } from '../../data/types'

interface TripMapProps {
  trip: Trip | null
  car: Car
  /** The car's place in the car list, which picks its 3D model. */
  carIndex: number
  /** The trip's route in time order (empty while loading or when there is none). */
  fixes: Position[]
  /** Replay time, ms since epoch. */
  time: number | null
  geofences: Geofence[]
  mode: MapMode
  mapRef: Ref<HistoryMapHandle>
}

/** The route map for the selected trip, with the car at the replay time. Re-renders every animation frame while playing. */
export function TripMap({ trip, car, carIndex, fixes, time, geofences, mode, mapRef }: TripMapProps) {
  const path = useMemo(() => routeCoordinates(fixes), [fixes])
  const driven = useMemo(() => (time === null ? [] : drivenCoordinates(fixes, time)), [fixes, time])

  // Every pill sits left of its point: the car's callout is on the right, so it never covers a label as the car passes.
  const markers = useMemo(() => {
    const first = fixes[0]
    const last = fixes[fixes.length - 1]
    if (!trip || !first || !last) return { start: null, end: null, stops: [] }
    const start: TripMarker = { position: [first.lon, first.lat], label: `Start ${formatClock(trip.startTime)}`, side: 'left' }
    // A trip still under way has not ended anywhere yet.
    const end: TripMarker | null =
      trip.endTime === null
        ? null
        : { position: [last.lon, last.lat], label: `${trip.endPlace ?? 'End'} ${formatClock(trip.endTime)}`, side: 'left' }
    const stops = trip.stops.map((s): TripMarker => ({
      position: [s.lon, s.lat] as LngLat,
      label: `Stop · ${formatDuration(s.durationMs)}`,
      side: 'left',
    }))
    return { start, end, stops }
  }, [trip, fixes])

  const point = time === null ? null : positionAt(fixes, time)
  const title = time === null ? '' : `${car.name} at ${formatClock(time)}`
  const detail =
    point && time !== null && trip
      ? `${Math.round(point.speedKmh)} km/h · ${formatDistance(distanceAlong(fixes, time, trip.endTime === null ? undefined : trip.distanceM))} in`
      : ''
  const historyCar: HistoryCar | null = point
    ? { index: carIndex, position: [point.lon, point.lat], course: point.course, title, detail }
    : null

  const fallbackCenter = useMemo<LngLat | null>(() => {
    const site = geofences.find((g) => g.kind === 'site') ?? geofences[0]
    return site ? centroid(site.polygon) : null
  }, [geofences])

  // The trip's own start and end pills name their places, so a place label there would only sit on top of them.
  const startPlace = trip?.startPlace
  const endPlace = trip?.endPlace
  const labelled = useMemo(
    () => geofences.filter((g) => g.kind === 'site' || (g.name !== startPlace && g.name !== endPlace)),
    [geofences, startPlace, endPlace],
  )

  const fallback: HistoryOverlay | undefined =
    trip && historyCar && markers.start
      ? {
          startLabel: markers.start.label,
          endLabel: markers.end?.label ?? 'In progress',
          stopLabels: markers.stops.map((s) => s.label),
          callout: { title: historyCar.title, detail: historyCar.detail },
        }
      : undefined

  return (
    <HistoryMapSurface
      ref={mapRef}
      path={path}
      driven={driven}
      start={markers.start}
      end={markers.end}
      stops={markers.stops}
      car={historyCar}
      geofences={labelled}
      fallbackCenter={fallbackCenter}
      mode={mode}
      fallback={fallback}
    />
  )
}
