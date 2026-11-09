import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { AsyncNotice } from '../../components/ui/AsyncNotice'
import { useTruckRecords } from '../../data/hooks'
import { EditRefused, type TruckEditor, type TruckInput, type TruckRecord } from '../../data/source'
import { TraccarHttpError } from '../../data/traccar/http'
import styles from './adminPanel.module.css'

interface Form extends TruckInput {
  id?: string
}

const emptyForm = (): Form => ({ name: '', trackerId: '', driver: '' })

function problemOf(form: Form): string | null {
  if (form.name.trim() === '') return 'Give the truck a name, for example DT-03.'
  if (form.trackerId.trim() === '') return 'Enter the tracker ID, exactly as the tracker sends it.'
  return null
}

function failureText(e: unknown, action: string): string {
  if (e instanceof EditRefused) return e.message
  if (e instanceof TraccarHttpError && (e.status === 401 || e.status === 403)) {
    return `Couldn't ${action}: the server refused. Sign in with an admin account that is not read-only.`
  }
  if (e instanceof TraccarHttpError && e.status === 400) return `Couldn't ${action}: Traccar did not accept it. Is the tracker ID already used?`
  return `Couldn't ${action}. Check the connection and try again.`
}

function details(t: TruckRecord): string {
  return [`Tracker ID ${t.trackerId || '(none)'}`, t.driver && `Driver ${t.driver}`].filter(Boolean).join(' · ')
}

export function TruckPanel({ editor, onDone }: { editor: TruckEditor; onDone: () => void }) {
  const trucks = useTruckRecords()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProblem, setShowProblem] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  const open = (next: Form | null) => {
    setError(null)
    setShowProblem(false)
    setConfirming(null)
    setForm(next)
  }

  async function run(action: string, task: () => Promise<void>, after?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await task()
      after?.()
    } catch (e) {
      setError(failureText(e, action))
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!form) return
    if (problemOf(form)) {
      setShowProblem(true)
      return
    }
    void run('save the truck', () => editor.save(form, form.id), () => open(null))
  }

  const problem = form ? problemOf(form) : null
  const list = trucks.status === 'ready' ? trucks.data : []

  return (
    <div className={styles.panel}>
      <div className={styles.headerActions}>
        {!form && (
          <button type="button" className={styles.primary} onClick={() => open(emptyForm())}>
            Add truck
          </button>
        )}
        <button type="button" className={styles.secondary} onClick={onDone}>
          Done
        </button>
      </div>

      {form && (
        <Card className={styles.form}>
          <h2 className={styles.formTitle}>{form.id ? 'Edit truck' : 'New truck'}</h2>
          <div className={styles.field}>
            <label htmlFor="truck-name">Name</label>
            <input id="truck-name" value={form.name} placeholder="DT-03" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label htmlFor="truck-tracker">Tracker ID</label>
            <input
              id="truck-tracker"
              aria-describedby="truck-tracker-hint"
              value={form.trackerId}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="358480081234567"
              onChange={(e) => setForm({ ...form, trackerId: e.target.value })}
            />
            <small id="truck-tracker-hint">
              The IMEI printed on the tracker (15 digits), the ID shown in the Traccar Client app, or the simulator's --id. It
              must match exactly, or the truck's positions are ignored.
            </small>
          </div>
          <div className={styles.field}>
            <label htmlFor="truck-driver">Driver (optional)</label>
            <input id="truck-driver" value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })} />
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
              {busy ? 'Saving...' : 'Save truck'}
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

      {trucks.status !== 'ready' && <AsyncNotice state={trucks} loading="Loading trucks..." />}
      {trucks.status === 'ready' && list.length === 0 && <p className={styles.empty}>No trucks yet. Add the first one.</p>}
      {list.length > 0 && (
        <ul className={styles.list} aria-label="All trucks">
          {list.map((t) => (
            <li key={t.id} className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.name}>
                  {t.name} {!t.enabled && <span className={styles.muted}>· Disabled</span>}
                </span>
                <span className={styles.where}>{details(t)}</span>
              </div>
              {confirming !== t.id && (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={busy}
                    onClick={() => open({ id: t.id, name: t.name, trackerId: t.trackerId, driver: t.driver })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={busy}
                    onClick={() => void run(t.enabled ? 'disable the truck' : 'enable the truck', () => editor.setEnabled(t.id, !t.enabled))}
                  >
                    {t.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className={styles.link} disabled={busy} onClick={() => setConfirming(t.id)}>
                    Delete
                  </button>
                </div>
              )}
              {confirming === t.id && (
                <div className={styles.confirm}>
                  <span>
                    Delete {t.name} and every position it has sent? This cannot be undone. To keep its history, disable it
                    instead.
                  </span>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => void run('delete the truck', () => editor.remove(t.id), () => setConfirming(null))}
                    >
                      {busy ? 'Deleting...' : 'Delete for good'}
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
