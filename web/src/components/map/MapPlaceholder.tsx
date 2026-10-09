// Phase 1 placeholder. A static port of the hand-drawn SVG map from the design mockups.
// Replaced by a real MapLibre map in Phase 3.
import type { CSSProperties } from 'react'
import type { CarStatus } from '../../data/types'

type Palette = 'a' | 'b' | 'hl'

const palettes: Record<Palette, [string, string, string]> = {
  a: ['var(--map-wall)', 'var(--map-wall-dark)', 'var(--map-roof)'],
  b: ['var(--map-wall-alt)', 'var(--map-wall-alt-dark)', 'var(--map-roof-alt)'],
  hl: ['var(--map-hl-wall)', 'var(--map-hl-wall-dark)', 'var(--map-hl-roof)'],
}

// [left wall, right wall, roof] point lists, drawn in this order.
const buildings: [Palette, string, string, string][] = [
  ['b', '328,38 430,95 430,135 328,78', '498,57 430,95 430,135 498,97', '396,0 498,57 430,95 328,38'],
  ['a', '464,94 566,151 566,211 464,154', '702,75 566,151 566,211 702,135', '600,18 702,75 566,151 464,94'],
  ['a', '158,181 239.6,226.6 239.6,256.6 158,211', '341.6,169.6 239.6,226.6 239.6,256.6 341.6,199.6', '260,124 341.6,169.6 239.6,226.6 158,181'],
  ['a', '702,121 787,168.5 787,258.5 702,211', '855,130.5 787,168.5 787,258.5 855,220.5', '770,83 855,130.5 787,168.5 702,121'],
  ['a', '314.4,192.6 423.2,253.4 423.2,298.4 314.4,237.6', '504.8,207.8 423.2,253.4 423.2,298.4 504.8,252.8', '396,147 504.8,207.8 423.2,253.4 314.4,192.6'],
  ['a', '617,228.5 702,276 702,306 617,258.5', '770,238 702,276 702,306 770,268', '685,190.5 770,238 702,276 617,228.5'],
  ['b', '736,266 821,313.5 821,353.5 736,306', '957,237.5 821,313.5 821,353.5 957,277.5', '872,190 957,237.5 821,313.5 736,266'],
  ['b', '181.8,286.7 283.8,343.7 283.8,368.7 181.8,311.7', '368.8,296.2 283.8,343.7 283.8,368.7 368.8,321.2', '266.8,239.2 368.8,296.2 283.8,343.7 181.8,286.7'],
  ['hl', '484.4,222.6 566,268.2 566,378.2 484.4,332.6', '647.6,222.6 566,268.2 566,378.2 647.6,332.6', '566,177 647.6,222.6 566,268.2 484.4,222.6'],
  ['a', '586.4,334.6 668,380.2 668,435.2 586.4,389.6', '749.6,334.6 668,380.2 668,435.2 749.6,389.6', '668,289 749.6,334.6 668,380.2 586.4,334.6'],
  ['b', '872,347 974,404 974,439 872,382', '1110,328 974,404 974,439 1110,363', '1008,271 1110,328 974,404 872,347'],
  ['b', '90,381 158,419 158,439 90,401', '226,381 158,419 158,439 226,401', '158,343 226,381 158,419 90,381'],
  ['a', '355.2,369.8 430,411.6 430,446.6 355.2,404.8', '511.6,366 430,411.6 430,446.6 511.6,401', '436.8,324.2 511.6,366 430,411.6 355.2,369.8'],
  ['a', '736,438 821,485.5 821,505.5 736,458', '889,447.5 821,485.5 821,505.5 889,467.5', '804,400 889,447.5 821,485.5 736,438'],
  ['a', '1008,408 1093,455.5 1093,505.5 1008,458', '1195,398.5 1093,455.5 1093,505.5 1195,448.5', '1110,351 1195,398.5 1093,455.5 1008,408'],
  ['a', '736,592 804,630 804,648 736,610', '872,592 804,630 804,648 872,610', '804,554 872,592 804,630 736,592'],
  ['b', '498,615 552.4,645.4 552.4,659.4 498,629', '606.8,615 552.4,645.4 552.4,659.4 606.8,629', '552.4,584.6 606.8,615 552.4,645.4 498,615'],
  ['hl', '583,648.5 685,705.5 685,733.5 583,676.5', '753,667.5 685,705.5 685,733.5 753,695.5', '651,610.5 753,667.5 685,705.5 583,648.5'],
]

const fill = (color: string): CSSProperties => ({ fill: color })

function Block({ pts, color }: { pts: string; color: string }) {
  return <polygon points={pts} style={fill(color)} />
}

/** Three-face box: left wall, right wall, top. */
function Box({ faces, colors }: { faces: [string, string, string]; colors: [string, string, string] }) {
  return (
    <>
      <Block pts={faces[0]} color={colors[0]} />
      <Block pts={faces[1]} color={colors[1]} />
      <Block pts={faces[2]} color={colors[2]} />
    </>
  )
}

function Car1() {
  return (
    <>
      <Box
        faces={['623.8,462.5 651,477.7 651,482.7 623.8,467.5', '712.2,443.5 651,477.7 651,482.7 712.2,448.5', '685,428.3 712.2,443.5 651,477.7 623.8,462.5']}
        colors={['#161920', '#101319', '#22262F']}
      />
      <Box
        faces={['623.8,454.5 651,469.7 651,478.7 623.8,463.5', '712.2,435.5 651,469.7 651,478.7 712.2,444.5', '685,420.3 712.2,435.5 651,469.7 623.8,454.5']}
        colors={['var(--car-red)', '#B5351B', '#FF7A5C']}
      />
      <Box
        faces={['641.8,439.5 663.6,451.6 663.6,459.6 641.8,447.5', '695.9,433.6 663.6,451.6 663.6,459.6 695.9,441.6', '674.1,421.4 695.9,433.6 663.6,451.6 641.8,439.5']}
        colors={['#C5CCDD', '#9AA3B8', '#F4F6FB']}
      />
    </>
  )
}

function Car2() {
  return (
    <>
      <Box
        faces={['644.2,565.1 705.4,599.3 705.4,604.3 644.2,570.1', '732.6,584.1 705.4,599.3 705.4,604.3 732.6,589.1', '671.4,549.9 732.6,584.1 705.4,599.3 644.2,565.1']}
        colors={['#161920', '#101319', '#22262F']}
      />
      <Box
        faces={['644.2,557.1 705.4,591.3 705.4,600.3 644.2,566.1', '732.6,576.1 705.4,591.3 705.4,600.3 732.6,585.1', '671.4,541.9 732.6,576.1 705.4,591.3 644.2,557.1']}
        colors={['#C5CCDD', '#9AA3B8', '#F4F6FB']}
      />
      <Box
        faces={['660.5,555.2 692.8,573.2 692.8,581.2 660.5,563.2', '714.6,561.1 692.8,573.2 692.8,581.2 714.6,569.1', '682.3,543 714.6,561.1 692.8,573.2 660.5,555.2']}
        colors={['var(--map-hl-wall)', 'var(--map-hl-wall-dark)', 'var(--map-hl-roof)']}
      />
    </>
  )
}

/** Pill width that fits the text (13px semibold, ~7.6px per character). */
function labelW(text: string): number {
  return Math.max(96, Math.ceil(text.length * 7.6) + 28)
}

function Label({ x, y, w, text }: { x: number; y: number; w: number; text: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="30" rx="15" style={{ fill: 'var(--card)', stroke: 'var(--line)' }} />
      <text x={x + w / 2} y={y + 20} textAnchor="middle" style={{ fill: 'var(--ink)' }} fontSize="13" fontWeight="600">
        {text}
      </text>
    </g>
  )
}

function Callout({ x, y, w, title, sub }: { x: number; y: number; w: number; title: string; sub: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="52" rx="16" style={{ fill: 'var(--card)', stroke: 'var(--line)' }} />
      <text x={x + 16} y={y + 22} style={{ fill: 'var(--ink)' }} fontSize="14" fontWeight="700">
        {title}
      </text>
      <text x={x + 16} y={y + 41} style={{ fill: 'var(--muted)' }} fontSize="12" fontFamily="var(--font-mono)">
        {sub}
      </text>
    </g>
  )
}

const TRAIL = '566,249 804,382 668,458'
const TRAIL_AHEAD_LIVE = '668,458 532,534 668,610'
const TRAIL_DRIVEN_HISTORY = '668,610 532,534 668,458'
const TRAIL_AHEAD_HISTORY = '668,458 804,382 566,249'

function Trail({ points, glowOpacity = 0.25 }: { points: string; glowOpacity?: number }) {
  const common = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <>
      <polyline points={points} {...common} style={{ stroke: 'var(--blue)' }} strokeOpacity={glowOpacity} strokeWidth="18" />
      <polyline points={points} {...common} style={{ stroke: 'var(--blue)' }} strokeWidth="6" />
    </>
  )
}

export interface LivePin {
  name: string
  status: CarStatus
  /** Second callout line, e.g. "42 km/h · 4 s ago". */
  detail: string
}

export interface HistoryOverlay {
  startLabel: string
  endLabel: string
  /** At most two are drawn (the illustration has two stop slots). */
  stopLabels: string[]
  callout: { title: string; detail: string }
}

export type MapPlaceholderProps =
  | {
      scene: 'live'
      /** One pin per car. The illustration has two pin slots; extra cars are not drawn. */
      pins: LivePin[]
      /** Name of the site zone geofence, drawn as the zone label. */
      siteName?: string
      /** Name of the place the trail starts from. */
      originName?: string
    }
  | { scene: 'history'; overlay?: HistoryOverlay }

const statusWord: Record<CarStatus, string> = { moving: 'Moving', parked: 'Parked', nosignal: 'No signal' }

const pinColor: Record<CarStatus, string> = {
  moving: 'var(--blue)',
  parked: 'var(--orange)',
  nosignal: 'var(--muted)',
}

// Fixed positions of the two illustrated cars: [pin x, pin y, line y1, line y2, callout x, callout y].
const PIN_SLOTS: [number, number, number, number, number, number][] = [
  [668, 376, 418, 396, 698, 350],
  [688, 504, 540, 524, 718, 478],
]

function Pin({ slot, index, pin }: { slot: (typeof PIN_SLOTS)[number]; index: number; pin: LivePin }) {
  const [x, y, y1, y2, cx, cy] = slot
  const color = pinColor[pin.status]
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2} style={{ stroke: color }} strokeWidth="3" />
      {pin.status === 'moving' && (
        <circle className="ping" cx={x} cy={y} r="20" fill="none" style={{ stroke: color }} strokeWidth="3" />
      )}
      <circle
        cx={x}
        cy={y}
        r="20"
        strokeWidth="4"
        strokeDasharray={pin.status === 'nosignal' ? '5 4' : undefined}
        style={{ fill: 'var(--card)', stroke: color }}
      />
      <text x={x} y={y + 5} textAnchor="middle" style={{ fill: 'var(--ink)' }} fontSize="13" fontWeight="700">
        {String(index + 1).padStart(2, '0')}
      </text>
      <Callout x={cx} y={cy} w={184} title={`${pin.name} · ${statusWord[pin.status]}`} sub={pin.detail} />
    </g>
  )
}

function ariaLabelFor(props: MapPlaceholderProps): string {
  if (props.scene === 'live') {
    const who = props.pins.map((p) => `${p.name} ${statusWord[p.status].toLowerCase()}`).join(', ')
    return `Illustrative map${who ? `: ${who}` : ''}`
  }
  return props.overlay
    ? 'Illustrative map of the selected trip with the playback position'
    : 'Illustrative map, no trip selected'
}

export function MapPlaceholder(props: MapPlaceholderProps) {
  const live = props.scene === 'live'
  return (
    <svg
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={ariaLabelFor(props)}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      <rect width="1200" height="800" style={fill('var(--map-ground)')} />
      <g fill="none" style={{ stroke: 'var(--map-ground-ring)' }} strokeWidth="2">
        <ellipse cx="190" cy="600" rx="170" ry="92" />
        <ellipse cx="190" cy="596" rx="120" ry="64" />
        <ellipse cx="190" cy="592" rx="70" ry="36" />
        <ellipse cx="1090" cy="700" rx="150" ry="80" />
        <ellipse cx="1090" cy="696" rx="96" ry="50" />
      </g>
      <polygon
        points="698.6,497.9 953.6,640.4 668,800 413,657.5"
        fillOpacity="0.06"
        strokeOpacity="0.7"
        strokeWidth="2"
        strokeDasharray="8 8"
        style={{ fill: 'var(--orange)', stroke: 'var(--orange)' }}
      />
      {props.scene === 'live' && props.siteName && (
        <text x="800" y="712" style={{ fill: 'var(--orange)' }} fontSize="13" fontWeight="700" letterSpacing="2">
          {props.siteName.toUpperCase()} ZONE
        </text>
      )}
      <g style={{ stroke: 'var(--map-road)' }} strokeWidth="18" strokeLinecap="round">
        <line x1="192" y1="40" x2="1144" y2="572" />
        <line x1="56" y1="116" x2="668" y2="458" />
        <line x1="906" y1="59" x2="294" y2="401" />
        <line x1="1144" y1="192" x2="532" y2="534" />
        <line x1="226" y1="363" x2="940" y2="762" />
        <line x1="668" y1="610" x2="396" y2="762" />
      </g>

      {live ? (
        <>
          <Trail points={TRAIL} />
          <polyline
            points={TRAIL_AHEAD_LIVE}
            fill="none"
            style={{ stroke: 'var(--slate)' }}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 12"
          />
        </>
      ) : (
        <>
          <Trail points={TRAIL_DRIVEN_HISTORY} />
          <polyline
            points={TRAIL_AHEAD_HISTORY}
            fill="none"
            style={{ stroke: 'var(--map-trail-ahead)' }}
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 12"
          />
        </>
      )}

      {buildings.map(([p, l, r, t], i) => (
        <Box key={i} faces={[l, r, t]} colors={palettes[p]} />
      ))}

      {props.scene === 'live' ? (
        <>
          <polyline
            points={TRAIL}
            fill="none"
            style={{ stroke: 'var(--blue)' }}
            strokeOpacity="0.45"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="566" cy="249" r="7" strokeWidth="3" style={{ fill: 'var(--map-ground)', stroke: 'var(--blue)' }} />
          {props.originName && <Label x={542 - labelW(props.originName)} y={200} w={labelW(props.originName)} text={props.originName} />}
          <Car1 />
          <Car2 />
          {props.pins.slice(0, PIN_SLOTS.length).map((pin, i) => (
            <Pin key={i} slot={PIN_SLOTS[i]} index={i} pin={pin} />
          ))}
        </>
      ) : (
        <>
          <polyline
            points={TRAIL_AHEAD_HISTORY}
            fill="none"
            style={{ stroke: 'var(--map-trail-ahead)' }}
            strokeOpacity="0.6"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="2 12"
          />
          {props.overlay && (
            <>
              <circle cx="668" cy="610" r="8" strokeWidth="3" style={{ fill: 'var(--blue)', stroke: 'var(--map-ground)' }} />
              <Label x={692} y={596} w={labelW(props.overlay.startLabel)} text={props.overlay.startLabel} />
              {props.overlay.stopLabels[0] && (
                <>
                  <rect x="575" y="497.5" width="16" height="16" rx="4" strokeWidth="3" style={{ fill: 'var(--orange)', stroke: 'var(--map-ground)' }} />
                  <Label x={562 - labelW(props.overlay.stopLabels[0])} y={490} w={labelW(props.overlay.stopLabels[0])} text={props.overlay.stopLabels[0]} />
                </>
              )}
              {props.overlay.stopLabels[1] && (
                <>
                  <rect x="677" y="307.5" width="16" height="16" rx="4" strokeWidth="3" style={{ fill: 'var(--orange)', stroke: 'var(--map-ground)' }} />
                  <Label x={706} y={300} w={labelW(props.overlay.stopLabels[1])} text={props.overlay.stopLabels[1]} />
                </>
              )}
              <circle cx="566" cy="249" r="8" strokeWidth="3" style={{ fill: 'var(--ink)', stroke: 'var(--map-ground)' }} />
              <Label x={542 - labelW(props.overlay.endLabel)} y={200} w={labelW(props.overlay.endLabel)} text={props.overlay.endLabel} />
              <Car1 />
              <Callout x={722} y={430} w={170} title={props.overlay.callout.title} sub={props.overlay.callout.detail} />
            </>
          )}
        </>
      )}
    </svg>
  )
}
