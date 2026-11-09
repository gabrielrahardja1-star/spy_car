import { useMemo, useState } from 'react'
import { LiveMapSurface } from '../../components/map/LiveMapSurface'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { formatDms } from '../../data/coords'
import { useDataSource } from '../../data/DataProvider'
import { useCanEditCheckpoints, useCanEditTrucks, useGeofences } from '../../data/hooks'
import split from '../split.module.css'
import { CheckpointPanel } from './CheckpointPanel'
import { formCircle, type CheckpointForm } from './checkpointForm'
import styles from './Manage.module.css'
import { TruckPanel } from './TruckPanel'

type Section = 'trucks' | 'checkpoints'

/** Admin screen: trucks (test or real, with their tracker) and checkpoints (placed on the map). */
export function Manage() {
  const source = useDataSource()
  const canEditTrucks = useCanEditTrucks()
  const canEditCheckpoints = useCanEditCheckpoints()
  const geofences = useGeofences()
  const fences = useMemo(() => (geofences.status === 'ready' ? geofences.data : []), [geofences])
  const checkpoints = useMemo(() => fences.filter((g) => g.kind === 'checkpoint'), [fences])
  const [section, setSection] = useState<Section>('trucks')
  const [form, setForm] = useState<CheckpointForm | null>(null)
  const draft = useMemo(() => (form ? formCircle(form) : null), [form])
  const onPick = useMemo(
    () => (form ? (lat: number, lon: number) => setForm({ ...form, location: formatDms({ lat, lon }) }) : null),
    [form],
  )

  if (!canEditTrucks && !canEditCheckpoints) {
    return (
      <main className={styles.denied}>
        <h1>Manage</h1>
        <p>Only an admin account that is not read-only can add or change trucks and checkpoints.</p>
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
            { value: 'checkpoints', label: `Checkpoints${checkpoints.length > 0 ? ` (${checkpoints.length})` : ''}` },
          ]}
          value={section}
          onChange={(v) => {
            setSection(v)
            setForm(null)
          }}
        />
        <h1 className={styles.title}>{section === 'trucks' ? 'Trucks' : 'Checkpoints'}</h1>
        {section === 'trucks' && source.trucks && canEditTrucks && <TruckPanel editor={source.trucks} />}
        {section === 'checkpoints' && (
          <CheckpointPanel
            checkpoints={checkpoints}
            editor={canEditCheckpoints ? (source.checkpoints ?? null) : null}
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
