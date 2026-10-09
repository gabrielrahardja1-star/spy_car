import styles from './ui.module.css'

export function StatTile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`${styles.tile} ${emphasis ? styles.tileEmphasis : ''}`.trim()}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
    </div>
  )
}
