import type { CarStatus } from '../../data/types'
import styles from './ui.module.css'

const config: Record<CarStatus, { word: string; pill: string; dot: string; shape: string }> = {
  moving: { word: 'Moving', pill: styles.pillMoving, dot: styles.dotRound, shape: 'round' },
  parked: { word: 'Parked', pill: styles.pillParked, dot: styles.dotSquare, shape: 'square' },
  nosignal: { word: 'No signal', pill: styles.pillNosignal, dot: styles.dotDashed, shape: 'dashed' },
}

/** Status is never colour alone: shape marker (round / square / dashed ring) plus the word. */
export function StatusPill({ status }: { status: CarStatus }) {
  const c = config[status]
  return (
    <span className={`${styles.pill} ${c.pill}`}>
      <span className={`${styles.dot} ${c.dot}`} data-shape={c.shape} aria-hidden="true" />
      {c.word}
    </span>
  )
}
