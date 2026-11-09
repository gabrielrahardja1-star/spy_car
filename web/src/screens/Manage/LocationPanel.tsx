import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { formatDms } from '../../data/coords'
import { EditRefused, type LocationEditor } from '../../data/source'
import { TraccarHttpError } from '../../data/traccar/http'
import type { Geofence } from '../../data/types'
import styles from './adminPanel.module.css'
import {
  formCircle,
  KIND_ORDER,
  KINDS,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  newForm,
  overlapsWith,
  problemOf,
  type LocationForm,
  type LocationKind,
} from './locationForm'

function failureText(e: unknown, action: 'save' | 'delete'): string {
  if (e instanceof EditRefused) return e.message
  if (e instanceof TraccarHttpError && (e.status === 401 || e.status === 403)) {
    return `Couldn't ${action}: the server refused. Sign in with an admin account that is not read-only.`
  }
  return `Couldn't ${action} the location. Check the connection and try again.`
}

interface Props {
  /** Every geofence; each is listed under its type. */
  locations: Geofence[]
  editor: LocationEditor | null
  form: LocationForm | null
  onFormChange: (form: LocationForm | null) => void
}

export function LocationPanel({ locations, editor, form, onFormChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [showProblem, setShowProblem] = useState(false)
  /** Overlap the admin was warned about; saving again with the same circle goes ahead. */
  const [overlapWarned, setOverlapWarned] = useState<string | null>(null)

  const open = (next: LocationForm | null) => {
    setError(null)
    setShowProblem(false)
    setConfirming(null)
    setOverlapWarned(null)
    onFormChange(next)
  }

  async function save() {
    if (!editor || !form) return
    const circle = formCircle(form)
    if (problemOf(form) || !circle) {
      setShowProblem(true)
      return
    }
    const overlap = overlapsWith(circle, form.id, locations)
    const key = `${circle.lat},${circle.lon},${circle.radiusM}`
    if (overlap.length > 0 && overlapWarned !== key) {
      setOverlapWarned(key)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await editor.save({ name: form.name, kind: form.kind, ...circle }, form.id)
      open(null)
    } catch (e) {
      setError(failureText(e, 'save'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!editor) return
    setBusy(true)
    setError(null)
    try {
      await editor.remove(id)
      setConfirming(null)
    } catch (e) {
      setError(failureText(e, 'delete'))
    } finally {
      setBusy(false)
    }
  }

  const problem = form ? problemOf(form) : null
  const draft = form ? formCircle(form) : null
  const overlap = form && draft && overlapWarned ? overlapsWith(draft, form.id, locations) : []
  const setKind = (kind: LocationKind) =>
    form && onFormChange({ ...form, kind, radius: form.radiusTouched ? form.radius : String(KINDS[kind].radiusM) })

  return (
    <div className={styles.panel}>
      {editor && !form && (
        <div className={styles.headerActions}>
          <button type="button" className={styles.primary} onClick={() => open(newForm())}>
            Add location
          </button>
        </div>
      )}

      {form && (
        <Card className={styles.form}>
          <h2 className={styles.formTitle}>{form.id ? 'Edit location' : 'New location'}</h2>
          <div className={styles.field}>
            <label htmlFor="loc-name">Name</label>
            <input id="loc-name" value={form.name} placeholder="Klinik" onChange={(e) => onFormChange({ ...form, name: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="loc-kind">Type</label>
            <select id="loc-kind" aria-describedby="loc-kind-hint" value={form.kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {KINDS[k].label}
                </option>
              ))}
            </select>
            <small id="loc-kind-hint">{KINDS[form.kind].hint}</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="loc-location">Location</label>
            <textarea
              id="loc-location"
              aria-describedby="loc-location-hint"
              rows={2}
              value={form.location}
              placeholder={`3°10'43.95"S 115°16'19.77"E`}
              onChange={(e) => onFormChange({ ...form, location: e.target.value })}
            />
            <small id="loc-location-hint">Tap the map to place it, or paste coordinates (degrees or decimals, any order).</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="loc-radius">Size (radius, m)</label>
            <input
              id="loc-radius"
              aria-describedby="loc-radius-hint"
              type="number"
              inputMode="numeric"
              min={MIN_RADIUS_M}
              max={MAX_RADIUS_M}
              value={form.radius}
              onChange={(e) => onFormChange({ ...form, radius: e.target.value, radiusTouched: true })}
            />
            <small id="loc-radius-hint">A truck anywhere inside the circle counts as there.</small>
          </div>
          {showProblem && problem && (
            <p role="alert" className={styles.error}>
              {problem}
            </p>
          )}
          {overlap.length > 0 && (
            <p role="alert" className={styles.error}>
              This circle overlaps {overlap.join(', ')}. A truck inside both would count as at either. Make it smaller, or
              press Save again to keep it.
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={save}>
              {busy ? 'Saving...' : 'Save location'}
            </button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => open(null)}>
              Cancel
            </button>
          </div>
        </Card>
      )}

      {!form && error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {locations.length === 0 && (
        <p className={styles.empty}>No locations yet.{editor ? ' Add the start points, the end point and any checkpoints.' : ''}</p>
      )}
      {KIND_ORDER.map((kind) => {
        const group = locations.filter((g) => g.kind === kind)
        if (group.length === 0) return null
        const label = kind === 'site' ? 'End point' : `${KINDS[kind].label}s`
        return (
          <section key={kind} className={styles.group}>
            <h3 className={styles.groupTitle}>{label}</h3>
            <ul className={styles.list} aria-label={label}>
              {group.map((g) => (
                <li key={g.id} className={styles.row}>
                  <div className={styles.rowText}>
                    <span className={styles.name}>{g.name}</span>
                    <span className={styles.where}>
                      {g.circle ? `${formatDms(g.circle)} · ${Math.round(g.circle.radiusM)} m` : 'Shape drawn in Traccar'}
                    </span>
                  </div>
                  {editor && confirming !== g.id && (
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.link}
                        disabled={busy || !g.circle}
                        title={g.circle ? undefined : 'Drawn as a shape in Traccar; change it there'}
                        onClick={() =>
                          g.circle &&
                          open({
                            id: g.id,
                            name: g.name,
                            kind: g.kind,
                            location: formatDms(g.circle),
                            radius: String(Math.round(g.circle.radiusM)),
                            radiusTouched: true,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button type="button" className={styles.link} disabled={busy} onClick={() => setConfirming(g.id)}>
                        Delete
                      </button>
                    </div>
                  )}
                  {confirming === g.id && (
                    <div className={styles.confirm}>
                      <span>
                        Delete {g.name} for everyone?{' '}
                        {kind === 'checkpoint' ? 'Past passes stop showing too.' : 'Trips from or to it lose its name.'}
                      </span>
                      <div className={styles.rowActions}>
                        <button type="button" className={styles.danger} disabled={busy} onClick={() => remove(g.id)}>
                          {busy ? 'Deleting...' : 'Delete'}
                        </button>
                        <button type="button" className={styles.link} disabled={busy} onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
