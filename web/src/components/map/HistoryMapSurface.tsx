// Loads the real Route history map on demand and falls back to the static illustration if it cannot run
// (no WebGL, blocked scripts, tiles unreachable at start). Keeps maplibre out of the main bundle.
import { useEffect, useState, type ComponentType, type Ref } from 'react'
import type { HistoryMapHandle, HistoryMapViewProps } from './HistoryMapView'
import { MapPlaceholder, type HistoryOverlay } from './MapPlaceholder'

type Props = Omit<HistoryMapViewProps, 'onFail' | 'ref'> & {
  ref?: Ref<HistoryMapHandle>
  /** The text the illustration shows if the real map cannot start. */
  fallback?: HistoryOverlay
}

export function HistoryMapSurface({ fallback, ref, ...view }: Props) {
  const [View, setView] = useState<ComponentType<HistoryMapViewProps> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('./HistoryMapView')
      .then((m) => !cancelled && setView(() => m.HistoryMapView))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return <MapPlaceholder scene="history" overlay={fallback} />
  if (!View) return null
  return <View {...view} ref={ref} onFail={() => setFailed(true)} />
}
