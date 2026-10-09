import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './ui.module.css'

export function PillButton({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={styles.pillButton} {...rest}>
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  children: ReactNode
  round?: boolean
}

export function IconButton({ children, round, ...rest }: IconButtonProps) {
  return (
    <button type="button" className={`${styles.iconButton} ${round ? styles.iconButtonRound : ''}`} {...rest}>
      {children}
    </button>
  )
}
