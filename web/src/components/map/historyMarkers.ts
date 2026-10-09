// DOM for the Route history map markers. Built by hand because maplibre Markers take a plain element.
import styles from './HistoryMapView.module.css'

export type TripMarkerKind = 'start' | 'end' | 'stop'
export type PillSide = 'left' | 'right'

/** A coloured dot (or square, for a stop) with its label pill to one side. The marker's centre is the place. */
export function createTripMarkerElement(kind: TripMarkerKind, label: string, side: PillSide): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', label)
  el.classList.add(styles.marker, styles[kind])
  const pill = document.createElement('div')
  pill.classList.add(styles.pill, side === 'left' ? styles.pillLeft : styles.pillRight)
  pill.textContent = label
  el.append(pill)
  return el
}

export interface CarMarkerElement {
  el: HTMLElement
  update(title: string, detail: string): void
  /** Show a flat dot at the car's position, for when the 3D model is not available. */
  setFlat(flat: boolean): void
}

/** The callout next to the car at the playback position. The marker's centre is the car. */
export function createCarMarkerElement(): CarMarkerElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  const dot = document.createElement('div')
  dot.className = styles.carFlat
  dot.hidden = true
  const callout = document.createElement('div')
  callout.className = styles.carCallout
  const title = document.createElement('div')
  title.className = styles.carTitle
  const detail = document.createElement('div')
  detail.className = styles.carDetail
  callout.append(title, detail)
  el.append(dot, callout)
  return {
    el,
    setFlat(flat) {
      dot.hidden = !flat
    },
    update(titleText, detailText) {
      // classList, not className: maplibre keeps its own marker classes (including the anchor) on this element.
      el.classList.add(styles.carMarker)
      // Written only when it changed: this runs every animation frame.
      if (title.textContent !== titleText) title.textContent = titleText
      if (detail.textContent !== detailText) detail.textContent = detailText
      const label = `${titleText}. ${detailText}`
      if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label)
      el.style.zIndex = '3'
    },
  }
}
