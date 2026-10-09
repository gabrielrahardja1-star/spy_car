// OWNED BY: derive agent. Pure formatting helpers. All clock output is in `config.timezone` unless a tz is passed.
import { config } from '../config'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** 4_320_000 -> "1 h 12 min"; 3_480_000 -> "58 min"; 20_000 -> "20 s"; 0 -> "0 min". Minutes are floored. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min'
  if (ms < MIN) return `${Math.floor(ms / 1000)} s`
  const totalMin = Math.floor(ms / MIN)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** 2:10 style "h:mm" used in the per-car breakdown lines, e.g. 7_800_000 -> "2:10". Minutes are floored. */
export function formatHm(ms: number): string {
  const totalMin = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MIN) : 0
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

/** The number part of formatDistance: 41_200 -> "41", 6_400 -> "6.4", 0 -> "0". For lines where the unit is implied. */
export function formatKmValue(m: number): string {
  const km = Number.isFinite(m) && m > 0 ? m / 1000 : 0
  if (km === 0) return '0'
  if (km < 9.95) return km.toFixed(1)
  return String(Math.round(km))
}

/** 41_200 -> "41 km" (rounded to whole km; under 10 km keep one decimal, e.g. "6.4 km"). */
export function formatDistance(m: number): string {
  return `${formatKmValue(m)} km`
}

/** Local clock "07:42" (24 h, zero padded). */
export function formatClock(t: number, tz: string = config.timezone): string {
  const p = localParts(t, tz)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/** Age as "4 s ago" (<60 s), "1 min ago" (<60 min), "2 h ago", "3 d ago". Negative ages count as 0. */
export function formatAge(ms: number): string {
  const a = Number.isFinite(ms) && ms > 0 ? ms : 0
  if (a < MIN) return `${Math.floor(a / 1000)} s ago`
  if (a < HOUR) return `${Math.floor(a / MIN)} min ago`
  if (a < DAY) return `${Math.floor(a / HOUR)} h ago`
  return `${Math.floor(a / DAY)} d ago`
}

/** "Thu 8 Oct 2026". */
export function formatDayLabel(t: number, tz: string = config.timezone): string {
  const p = localParts(t, tz)
  return `${p.weekday} ${p.day} ${p.monthShort} ${p.year}`
}

/** "Fri 2" (weekday + day of month). */
export function formatShortDay(t: number, tz: string = config.timezone): string {
  const p = localParts(t, tz)
  return `${p.weekday} ${p.day}`
}

/** Start (inclusive) and end (exclusive) of the local calendar day containing `t`. DST-safe via Intl. */
export function dayBounds(t: number, tz: string = config.timezone): { start: number; end: number } {
  const p = localParts(t, tz)
  return { start: startOfLocalDay(p.year, p.month, p.day, tz), end: startOfLocalDay(p.year, p.month, p.day + 1, tz) }
}

/** Start of the local day `n` days after (or before, n < 0) the day starting at `dayStart`. */
export function addDays(dayStart: number, n: number, tz: string = config.timezone): number {
  const p = localParts(dayStart, tz)
  return startOfLocalDay(p.year, p.month, p.day + n, tz)
}

/**
 * Instant of the local wall-clock `hour` (may be fractional, e.g. 6.5) on the local day containing `dayStart`.
 * DST-safe: the hour is a wall-clock hour, not `dayStart + hour * 3_600_000`.
 */
export function atLocalHour(dayStart: number, hour: number, tz: string = config.timezone): number {
  const p = localParts(dayStart, tz)
  const h = Math.floor(hour)
  return localToUtc(p.year, p.month, p.day, h, Math.round((hour - h) * 60), tz)
}

// ---------------------------------------------------------------------------------------------
// Internals

const pad2 = (n: number) => String(n).padStart(2, '0')

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(tz, f)
  }
  return f
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface LocalParts {
  year: number
  month: number // 1..12
  day: number
  hour: number
  minute: number
  second: number
  weekday: string // "Thu"
  monthShort: string // "Oct"
}

function localParts(t: number, tz: string): LocalParts {
  const out: Record<string, string> = {}
  for (const part of formatterFor(tz).formatToParts(t)) out[part.type] = part.value
  const month = Number(out.month)
  return {
    year: Number(out.year),
    month,
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday,
    monthShort: MONTHS[month - 1],
  }
}

/** Offset (local minus UTC, ms) in effect at instant `t`. */
function offsetAt(t: number, tz: string): number {
  const p = localParts(t, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(t / 1000) * 1000
}

/** Local wall-clock time -> instant. Month/day may overflow (Date.UTC normalises them). */
function localToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const t1 = guess - offsetAt(guess, tz)
  const off2 = offsetAt(t1, tz)
  // Offset changed between the guess and the result: the wall time sits next to a DST jump; use the later offset.
  return off2 === guess - t1 ? t1 : guess - off2
}

/** First instant of the local calendar day y-mo-d (handles zones whose DST jump skips local midnight). */
function startOfLocalDay(y: number, mo: number, d: number, tz: string): number {
  const target = Date.UTC(y, mo - 1, d) // normalised, so compare as a date key
  let t = localToUtc(y, mo, d, 0, 0, tz)
  for (let i = 0; i < 3; i++) {
    const p = localParts(t, tz)
    if (Date.UTC(p.year, p.month - 1, p.day) >= target) break
    t += HOUR
  }
  return t
}
