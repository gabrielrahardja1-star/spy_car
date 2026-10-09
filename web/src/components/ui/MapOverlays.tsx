import { IconButton, PillButton } from './Buttons'
import { SegmentedControl } from './SegmentedControl'
import styles from './ui.module.css'

export function Legend() {
  return (
    <div className={`${styles.floating} ${styles.legend}`}>
      <div className={styles.legendTitle}>Legend</div>
      <div className={styles.legendRow} style={{ color: 'var(--blue)' }}>
        <span className={styles.swatchRing} aria-hidden="true" />
        <span style={{ color: 'var(--ink)' }}>Moving</span>
      </div>
      <div className={styles.legendRow} style={{ color: 'var(--orange)' }}>
        <span className={styles.swatchRing} aria-hidden="true" />
        <span style={{ color: 'var(--ink)' }}>Parked</span>
      </div>
      <div className={styles.legendRow} style={{ color: 'var(--muted)' }}>
        <span className={`${styles.swatchRing} ${styles.swatchDashedRing}`} aria-hidden="true" />
        <span style={{ color: 'var(--ink)' }}>No signal</span>
      </div>
      <div className={styles.legendRow}>
        <span className={styles.swatchTrail} aria-hidden="true" />
        Today's trail
      </div>
      <div className={styles.legendRow}>
        <span className={styles.swatchZone} aria-hidden="true" />
        Site zone
      </div>
    </div>
  )
}

export type MapMode = '2d' | '3d'

/** `inline` drops the corner placement, for a screen that lays the controls out itself (above the playback bar). */
export function ModeToggle({ mode, onChange, inline }: { mode: MapMode; onChange: (m: MapMode) => void; inline?: boolean }) {
  return (
    <div className={inline ? undefined : styles.floating} style={inline ? undefined : { left: 16, bottom: 16 }}>
      <SegmentedControl
        label="Map view"
        value={mode}
        onChange={onChange}
        options={[
          { value: '2d', label: '2D' },
          { value: '3d', label: '3D' },
        ]}
      />
    </div>
  )
}

interface ViewControlsProps {
  /** Text of the fit button. */
  fitLabel?: string
  inline?: boolean
  onFit?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
}

export function ViewControls({ fitLabel = 'Fit both cars', inline, onFit, onZoomIn, onZoomOut }: ViewControlsProps) {
  const corner = inline ? {} : { right: 16, bottom: 16 }
  return (
    <div className={inline ? undefined : styles.floating} style={{ ...corner, display: 'flex', alignItems: 'center', gap: 8 }}>
      <PillButton onClick={onFit}>{fitLabel}</PillButton>
      <div className={styles.zoomGroup}>
        <IconButton round aria-label="Zoom out" onClick={onZoomOut}>
          −
        </IconButton>
        <IconButton round aria-label="Zoom in" onClick={onZoomIn}>
          +
        </IconButton>
      </div>
    </div>
  )
}
