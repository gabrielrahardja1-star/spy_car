import type { CSSProperties, ReactNode } from 'react'
import styles from './ui.module.css'

interface CardProps {
  children: ReactNode
  selected?: boolean
  /** Border colour when selected. */
  accent?: string
  className?: string
  style?: CSSProperties
  as?: 'div' | 'section'
  ariaLabel?: string
}

export function Card({ children, selected, accent, className, style, as: Tag = 'div', ariaLabel }: CardProps) {
  const cls = [styles.card, selected ? styles.cardSelected : '', className ?? ''].join(' ').trim()
  return (
    <Tag
      className={cls}
      aria-label={ariaLabel}
      style={selected && accent ? { borderColor: accent, ...style } : style}
    >
      {children}
    </Tag>
  )
}
