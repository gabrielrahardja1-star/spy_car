import styles from './ui.module.css'

interface Option<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  fill?: boolean
}

export function SegmentedControl<T extends string>({ options, value, onChange, label, fill }: Props<T>) {
  return (
    <div role="group" aria-label={label} className={`${styles.segmented} ${fill ? styles.segmentedFill : ''}`}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            className={`${styles.segment} ${active ? styles.segmentActive : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
