import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { formatDms } from '../../data/coords'
import type { CheckpointEditor } from '../../data/source'
import { TraccarHttpError } from '../../data/traccar/http'
import type { Geofence } from '../../data/types'
import { formCircle, MAX_RADIUS_M, MIN_RADIUS_M, newForm, problemOf, type CheckpointForm } from './checkpointForm'
import styles from './CheckpointPanel.module.css'

function failureText(e: unknown, action: 'save' | 'delete'): string {
  if (e instanceof TraccarHttpError && (e.status === 401 || e.status === 403)) {
    return `Couldn't ${action}: the server refused. Sign in with an admin account that is not read-only.`
  }
  return `Couldn't ${action} the checkpoint. Check the connection and try again.`
}

interface Props {
  checkpoints: Geofence[]
  editor: CheckpointEditor | null
  form: CheckpointForm | null
  onFormChange: (form: CheckpointForm | null) => void
}

export function CheckpointPanel({ checkpoints, editor, form, onFormChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [showProblem, setShowProblem] = useState(false)

  const open = (next: CheckpointForm | null) => {
    setError(null)
    setShowProblem(false)
    setConfirming(null)
    onFormChange(next)
  }

  async function save() {
    if (!editor || !form) return
    const circle = formCircle(form)
    if (problemOf(form) || !circle) {
      setShowProblem(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await editor.save({ name: form.name, ...circle }, form.id)
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

  return (
    <div className={styles.panel}>
      {editor && !form && (
        <button type="button" className={styles.primary} onClick={() => open(newForm())}>
          Add checkpoint
        </button>
      )}

      {form && (
        <Card className={styles.form}>
          <h2 className={styles.formTitle}>{form.id ? 'Edit checkpoint' : 'New checkpoint'}</h2>
          <div className={styles.field}>
            <label htmlFor="cp-name">Name</label>
            <input id="cp-name" value={form.name} placeholder="CP1 West gate" onChange={(e) => onFormChange({ ...form, name: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="cp-location">Location</label>
            <textarea
              id="cp-location"
              aria-describedby="cp-location-hint"
              rows={2}
              value={form.location}
              placeholder={`3°10'21.04"S 115°16'54.51"E`}
              onChange={(e) => onFormChange({ ...form, location: e.target.value })}
            />
            <small id="cp-location-hint">Tap the map to place it, or paste coordinates (degrees or decimals).</small>
          </div>
          <div className={styles.field}>
            <label htmlFor="cp-radius">Size (radius, m)</label>
            <input
              id="cp-radius"
              aria-describedby="cp-radius-hint"
              type="number"
              inputMode="numeric"
              min={MIN_RADIUS_M}
              max={MAX_RADIUS_M}
              value={form.radius}
              onChange={(e) => onFormChange({ ...form, radius: e.target.value })}
            />
            <small id="cp-radius-hint">About 30 m covers a haul road. A truck passing anywhere inside counts.</small>
          </div>
          {showProblem && problem && (
            <p role="alert" className={styles.error}>
              {problem}
            </p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={save}>
              {busy ? 'Saving...' : 'Save checkpoint'}
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

      {checkpoints.length === 0 ? (
        <p className={styles.empty}>
          No checkpoints yet.{editor ? ' Add one, then every truck that passes it is logged.' : ''}
        </p>
      ) : (
        <ul className={styles.list} aria-label="Checkpoints">
          {checkpoints.map((g) => (
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
                      open({ id: g.id, name: g.name, location: formatDms(g.circle), radius: String(Math.round(g.circle.radiusM)) })
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
                  <span>Delete {g.name} for everyone? Past passes stop showing too.</span>
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
      )}
    </div>
  )
}
