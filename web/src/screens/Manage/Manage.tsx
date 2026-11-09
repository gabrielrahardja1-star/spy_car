import { useMemo, useState } from 'react'
import { LiveMapSurface } from '../../components/map/LiveMapSurface'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { formatDms } from '../../data/coords'
import { useDataSource } from '../../data/DataProvider'
import { useCanEditLocations, useCanEditTrucks, useGeofences } from '../../data/hooks'
import split from '../split.module.css'
import { LocationPanel } from './LocationPanel'
import { formCircle, type LocationForm } from './locationForm'
import styles from './Manage.module.css'
import { TruckPanel } from './TruckPanel'

type Section = 'trucks' | 'locations'

/** Admin screen: trucks (test or real, with their tracker) and locations: start points, end point, checkpoints. */
export function Manage() {
  const source = useDataSource()
  const canEditTrucks = useCanEditTrucks()
  const canEditLocations = useCanEditLocations()
  const geofences = useGeofences()
  const fences = useMemo(() => (geofences.status === 'ready' ? geofences.data : []), [geofences])
  const [section, setSection] = useState<Section>('trucks')
  const [form, setForm] = useState<LocationForm | null>(null)
  const draft = useMemo(() => (form ? formCircle(form) : null), [form])
  const onPick = useMemo(
    () => (form ? (lat: number, lon: number) => setForm({ ...form, location: formatDms({ lat, lon }) }) : null),
    [form],
  )

  if (!canEditTrucks && !canEditLocations) {
    return (
      <main className={styles.denied}>
        <h1>Manage</h1>
        <p>Only an admin account that is not read-only can add or change trucks and locations.</p>
      </main>
    )
  }

  return (
    <main className={split.main}>
      <section aria-label="Manage" className={split.panel}>
        <SegmentedControl<Section>
          label="Manage"
          fill
          options={[
            { value: 'trucks', label: 'Trucks' },
            { value: 'locations', label: `Locations${fences.length > 0 ? ` (${fences.length})` : ''}` },
          ]}
          value={section}
          onChange={(v) => {
            setSection(v)
            setForm(null)
          }}
        />
        <h1 className={styles.title}>{section === 'trucks' ? 'Trucks' : 'Locations'}</h1>
        {section === 'trucks' && source.trucks && canEditTrucks && <TruckPanel editor={source.trucks} />}
        {section === 'locations' && (
          <LocationPanel
            locations={fences}
            editor={canEditLocations ? (source.locations ?? null) : null}
            form={form}
            onFormChange={setForm}
          />
        )}
      </section>
      <section aria-label="Map" className={split.map}>
        <LiveMapSurface pins={[]} selectedId={null} geofences={fences} trail={[]} mode="2d" onSelect={() => {}} draft={draft} onPick={onPick} />
      </section>
    </main>
  )
}
