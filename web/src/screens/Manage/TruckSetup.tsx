import { config } from '../../config'
import type { TruckRecord } from '../../data/source'
import { OSMAND_PORT, trackerModel } from '../../data/trackers'
import styles from './adminPanel.module.css'

/** The server address to show; a plain-word placeholder (no angle brackets, which a shell would read as redirection). */
const server = () => config.trackerServer || 'SERVER-IP'

/** How to make a truck start reporting: the simulator command, the phone app's settings or the tracker's settings. */
export function TruckSetup({ truck }: { truck: TruckRecord }) {
  const host = server()
  const unset = config.trackerServer === '' && (
    <p className={styles.note}>Replace SERVER-IP with the server's IP address (set VITE_TRACKER_SERVER to show it here).</p>
  )

  if (truck.source === 'simulator') {
    return (
      <div className={styles.setup}>
        <p>On a computer with this project, in the <code>web</code> folder, run:</p>
        <pre className={styles.code}>
          {`npm run simulate-car -- --host ${host} --id ${truck.trackerId} --profile dump-truck --lat -3.16880 --lon 115.26846 --to-lat -3.172511 --to-lon 115.281808`}
        </pre>
        <p className={styles.note}>It drives Pit W to Area 2 and back on real roads until you press Ctrl+C.</p>
        {unset}
      </div>
    )
  }

  if (truck.source === 'phone') {
    return (
      <div className={styles.setup}>
        <p>In the Traccar Client app on the phone:</p>
        <dl className={styles.settings}>
          <dt>Server URL</dt>
          <dd>
            <code>{`http://${host}:${OSMAND_PORT}`}</code>
          </dd>
          <dt>Device identifier</dt>
          <dd>
            <code>{truck.trackerId}</code>
          </dd>
          <dt>Frequency</dt>
          <dd>10 s</dd>
        </dl>
        <p className={styles.note}>Then switch Service status on. Keep the phone charging in the cab.</p>
        {unset}
      </div>
    )
  }

  const model = trackerModel(truck.model)
  if (!model) {
    return (
      <div className={styles.setup}>
        <p>
          This tracker model is not set up on the server yet. Send its make and model to whoever maintains the server so its
          protocol can be enabled.
        </p>
      </div>
    )
  }
  return (
    <div className={styles.setup}>
      <p>Set the tracker to send its positions to:</p>
      <dl className={styles.settings}>
        <dt>Server</dt>
        <dd>
          <code>{host}</code>
        </dd>
        <dt>Port</dt>
        <dd>
          <code>{model.port}</code> (TCP, {model.protocol} protocol)
        </dd>
        <dt>Device ID</dt>
        <dd>
          <code>{truck.trackerId}</code> (its IMEI, nothing to set)
        </dd>
      </dl>
      <p className={styles.note}>
        Trackers are usually set by SMS to their SIM{truck.phone ? ` (${truck.phone})` : ''}; the exact message is in the
        tracker's manual. The SIM needs mobile data, and its APN may need setting too.
      </p>
      <p className={styles.note}>
        Once per tracker family, on the server: set <code>{model.bindVar}=0.0.0.0</code> in <code>deploy/.env</code> and run{' '}
        <code>docker compose up -d</code> in <code>deploy/</code>, so port {model.port} accepts connections.
      </p>
      {unset}
    </div>
  )
}
