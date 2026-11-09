import { useState } from 'react'
import { AsyncNotice } from '../../components/ui/AsyncNotice'
import { Card } from '../../components/ui/Card'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { useTruckRecords } from '../../data/hooks'
import { EditRefused, type TruckEditor, type TruckInput, type TruckRecord } from '../../data/source'
import { TraccarHttpError } from '../../data/traccar/http'
import { isValidImei, simulatorId, TRACKER_MODELS, trackerModel, type TruckSource } from '../../data/trackers'
import styles from './adminPanel.module.css'
import { TruckSetup } from './TruckSetup'

type Kind = 'test' | 'real'

interface Form extends TruckInput {
  id?: string
  /** True once the tracker ID was typed by hand, so the simulator ID stops following the name. */
  idTouched: boolean
}

const emptyForm = (): Form => ({ name: '', source: 'simulator', trackerId: '', model: '', phone: '', driver: '', idTouched: false })

const kindOf = (source: TruckSource): Kind => (source === 'tracker' ? 'real' : 'test')

/** The tracker ID the form will save: a simulator truck gets one made from its name unless it was typed. */
const trackerIdOf = (form: Form) => (form.source === 'simulator' && !form.idTouched ? simulatorId(form.name) : form.trackerId)

function problemOf(form: Form): string | null {
  if (form.name.trim() === '') return 'Give the truck a name, for example DT-03.'
  const id = trackerIdOf(form).trim()
  if (form.source === 'tracker') {
    if (!form.model) return 'Choose the tracker model.'
    if (!isValidImei(id)) return 'Enter the 15-digit IMEI from the tracker label. That one does not check out; look for a typo.'
  } else if (id === '') {
    return form.source === 'phone' ? 'Enter the device identifier shown in the Traccar Client app.' : 'Enter a tracker ID.'
  }
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
  const how =
    t.source === 'simulator'
      ? `Simulator · ID ${t.trackerId}`
      : t.source === 'phone'
        ? `Phone app · ID ${t.trackerId}`
        : `${trackerModel(t.model)?.label.replace(/ \(.*\)$/, '') ?? 'GPS tracker'} · IMEI ${t.trackerId}${t.phone ? ` · SIM ${t.phone}` : ''}`
  return [how, t.driver && `Driver ${t.driver}`].filter(Boolean).join(' · ')
}

export function TruckPanel({ editor }: { editor: TruckEditor }) {
  const trucks = useTruckRecords()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProblem, setShowProblem] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  /** The truck whose setup steps are open; set after adding one so the next step is right there. */
  const [setupOf, setSetupOf] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)

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
    const { id, idTouched: _touched, ...input } = form
    const trackerId = trackerIdOf(form).trim()
    void run('save the truck', () => editor.save({ ...input, trackerId }, id), () => {
      open(null)
      if (id === undefined) setJustAdded(trackerId)
    })
  }

  const list = trucks.status === 'ready' ? trucks.data : []
  // After adding, open the new truck's setup steps (found by its tracker ID once the list has reloaded).
  const added = justAdded ? list.find((t) => t.trackerId === justAdded) : undefined
  if (added) {
    setJustAdded(null)
    setSetupOf(added.id)
  }
  const problem = form ? problemOf(form) : null

  return (
    <div className={styles.panel}>
      {!form && (
        <div className={styles.headerActions}>
          <button type="button" className={styles.primary} onClick={() => open(emptyForm())}>
            Add truck
          </button>
        </div>
      )}

      {form && (
        <Card className={styles.form}>
          <h2 className={styles.formTitle}>{form.id ? 'Edit truck' : 'New truck'}</h2>
          <div className={styles.field}>
            <label htmlFor="truck-name">Name</label>
            <input id="truck-name" value={form.name} placeholder="DT-03" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Type</span>
            <SegmentedControl<Kind>
              label="Truck type"
              fill
              options={[
                { value: 'test', label: 'Test truck' },
                { value: 'real', label: 'Real truck' },
              ]}
              value={kindOf(form.source)}
              onChange={(k) => setForm({ ...form, source: k === 'real' ? 'tracker' : 'simulator', trackerId: '', idTouched: false })}
            />
          </div>

          {form.source !== 'tracker' && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Driven by</span>
              <SegmentedControl<TruckSource>
                label="Test truck driven by"
                fill
                options={[
                  { value: 'simulator', label: 'Simulator' },
                  { value: 'phone', label: 'Phone app' },
                ]}
                value={form.source}
                onChange={(source) => setForm({ ...form, source, trackerId: '', idTouched: false })}
              />
            </div>
          )}

          {form.source === 'tracker' && (
            <div className={styles.field}>
              <label htmlFor="truck-model">Tracker model</label>
              <select id="truck-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                <option value="">Choose...</option>
                {TRACKER_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
              <small>Another make? The server has to be set up for it first; ask before buying.</small>
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="truck-tracker">{form.source === 'tracker' ? 'IMEI' : form.source === 'phone' ? 'Device identifier' : 'Tracker ID'}</label>
            <input
              id="truck-tracker"
              aria-describedby="truck-tracker-hint"
              value={trackerIdOf(form)}
              inputMode={form.source === 'tracker' ? 'numeric' : 'text'}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={form.source === 'tracker' ? '15 digits' : form.source === 'phone' ? 'From the app' : 'sim-dt-03'}
              onChange={(e) => setForm({ ...form, trackerId: e.target.value, idTouched: true })}
            />
            <small id="truck-tracker-hint">
              {form.source === 'tracker'
                ? 'Printed on the tracker label (also on its box). Traccar knows the tracker by it.'
                : form.source === 'phone'
                  ? 'Shown on the main screen of the Traccar Client app.'
                  : 'Made from the name; the simulator sends it with --id.'}
            </small>
          </div>

          {form.source === 'tracker' && (
            <div className={styles.field}>
              <label htmlFor="truck-phone">SIM number (optional)</label>
              <input
                id="truck-phone"
                type="tel"
                value={form.phone}
                placeholder="+62 812 ..."
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <small>The tracker's own SIM card, used to set it up by SMS.</small>
            </div>
          )}

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
                  {t.name}
                  {t.source !== 'tracker' && <span className={styles.badge}>Test</span>}
                  {!t.enabled && <span className={styles.muted}> · Disabled</span>}
                </span>
                <span className={styles.where}>{details(t)}</span>
              </div>
              {confirming !== t.id && (
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.link}
                    aria-expanded={setupOf === t.id}
                    onClick={() => setSetupOf(setupOf === t.id ? null : t.id)}
                  >
                    Setup
                  </button>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={busy}
                    onClick={() =>
                      open({ id: t.id, name: t.name, source: t.source, trackerId: t.trackerId, model: t.model, phone: t.phone, driver: t.driver, idTouched: true })
                    }
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
              {setupOf === t.id && confirming !== t.id && <TruckSetup truck={t} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
