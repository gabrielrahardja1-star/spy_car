// Loads the real map on demand and falls back to the static illustration if it cannot run
// (no WebGL, blocked scripts, tiles unreachable at start). Keeps maplibre out of the main bundle.
import { useEffect, useState, type ComponentType, type Ref } from 'react'
import type { LiveMapViewProps, MapHandle } from './LiveMapView'
import { MapPlaceholder, type LivePin } from './MapPlaceholder'

type Props = Omit<LiveMapViewProps, 'onFail' | 'ref'> & {
  ref?: Ref<MapHandle>
  siteName?: string
  originName?: string
}

export function LiveMapSurface({ siteName, originName, ref, ...view }: Props) {
  const [View, setView] = useState<ComponentType<LiveMapViewProps> | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    import('./LiveMapView')
      .then((m) => !cancelled && setView(() => m.LiveMapView))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) {
    const pins: LivePin[] = view.pins.map((p) => ({ name: p.name, status: p.status, detail: p.detail }))
    return <MapPlaceholder scene="live" pins={pins} siteName={siteName} originName={originName} />
  }
  if (!View) return null
  return <View {...view} ref={ref} onFail={() => setFailed(true)} />
}
