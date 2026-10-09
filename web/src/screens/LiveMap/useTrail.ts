import { useMemo } from 'react'
import { trailCoordinates, type LngLat } from '../../components/map/mapGeometry'
import { useRoute } from '../../data/hooks'
import type { LiveCar } from '../../data/types'

/** Today's trail for one car: the stored route plus its newest live fix. Empty until the route loads. */
export function useTrail(live: LiveCar | undefined, dayStart: number, dayEnd: number): LngLat[] {
  const route = useRoute(live?.car.id ?? null, dayStart, dayEnd)
  const routePoints = route.status === 'ready' ? route.data : null
  const latest = live?.position ?? null
  return useMemo(() => (routePoints ? trailCoordinates(routePoints, latest) : []), [routePoints, latest])
}
