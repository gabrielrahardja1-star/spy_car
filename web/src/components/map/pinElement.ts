// DOM for one car pin. Built by hand because maplibre Markers take a plain element.
import type { CarStatus } from '../../data/types'
import styles from './LiveMapView.module.css'
import type { MapPin } from './mapGeometry'

const statusWord: Record<CarStatus, string> = { moving: 'Moving', parked: 'Parked', nosignal: 'No signal' }

export interface PinElement {
  el: HTMLElement
  update(pin: MapPin, selected: boolean): void
  /** Show a flat dot at the car's position, for when the 3D model is not available. */
  setFlat(flat: boolean): void
}

export function createPinElement(onClick: () => void): PinElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')

  const stem = document.createElement('div')
  stem.className = styles.stem
  const ring = document.createElement('div')
  // "ping" is the global pulse animation (styles/global.css), which also honours reduced motion.
  ring.className = `${styles.ring} ping`
  const dot = document.createElement('div')
  dot.className = styles.flatDot
  dot.hidden = true
  const badge = document.createElement('div')
  badge.className = styles.badge
  const callout = document.createElement('div')
  callout.className = styles.callout
  const title = document.createElement('div')
  title.className = styles.calloutTitle
  const detail = document.createElement('div')
  detail.className = styles.calloutDetail
  callout.append(title, detail)
  el.append(dot, stem, ring, badge, callout)
  el.addEventListener('click', onClick)

  return {
    el,
    setFlat(flat) {
      dot.hidden = !flat
    },
    update(pin, selected) {
      // classList, not className: maplibre keeps its own marker classes (including the anchor) on this element.
      el.classList.add(styles.pin)
      for (const status of ['moving', 'parked', 'nosignal'] as const) el.classList.toggle(styles[status], status === pin.status)
      el.classList.toggle(styles.selected, selected)
      ring.hidden = pin.status !== 'moving'
      badge.textContent = String(pin.index + 1).padStart(2, '0')
      title.textContent = `${pin.name} · ${statusWord[pin.status]}`
      detail.textContent = pin.detail
      el.setAttribute('aria-label', `${pin.name}, ${statusWord[pin.status].toLowerCase()}. ${pin.detail}`)
      el.style.zIndex = selected ? '2' : '1'
    },
  }
}

export function createLabelElement(text: string, className: string): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  el.textContent = text
  return el
}
