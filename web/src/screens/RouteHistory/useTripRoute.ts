import { useMemo } from 'react'
import { sortFixes } from '../../components/map/playback'
import { useRoute, type Async } from '../../data/hooks'
import type { Position, Trip } from '../../data/types'

/** How far past its start a trip still under way is searched. A fixed window, so the request does not change every second. */
const OPEN_TRIP_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The selected trip's path in time order. With no trip it is an empty, ready route (no request is made).
 * The bounds come from the trip alone, never from the clock, so the route is fetched once per trip.
 * A trip still under way shows the route as it was when the trip was selected.
 */
export function useTripRoute(trip: Trip | null): Async<Position[]> {
  const from = trip?.startTime ?? 0
  const to = (trip ? (trip.endTime ?? trip.startTime + OPEN_TRIP_WINDOW_MS) : 0) + 1
  const route = useRoute(trip?.carId ?? null, from, to)
  return useMemo<Async<Position[]>>(
    () => (route.status === 'ready' ? { status: 'ready', data: sortFixes(route.data) } : route),
    [route],
  )
}
