import { describe, expect, it } from 'vitest'
import {
  addDays,
  atLocalHour,
  dayBounds,
  formatAge,
  formatClock,
  formatDayLabel,
  formatDistance,
  formatDuration,
  formatHm,
  formatKmValue,
  formatShortDay,
} from './format'

const H = 3_600_000
const MAK = 'Asia/Makassar' // UTC+8, no DST
const utc = (s: string) => Date.parse(s)

describe('formatDuration', () => {
  it('formats minutes, hours and seconds', () => {
    expect(formatDuration(3_420_000)).toBe('57 min')
    expect(formatDuration(3_480_000)).toBe('58 min')
    expect(formatDuration(4_320_000)).toBe('1 h 12 min')
    expect(formatDuration(3 * H + 25 * 60_000)).toBe('3 h 25 min')
    expect(formatDuration(2 * H)).toBe('2 h')
    expect(formatDuration(20_000)).toBe('20 s')
    expect(formatDuration(60_000)).toBe('1 min')
  })
  it('handles zero and negatives', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(-5)).toBe('0 min')
  })
})

describe('formatHm', () => {
  it('formats h:mm', () => {
    expect(formatHm(7_800_000)).toBe('2:10')
    expect(formatHm(0)).toBe('0:00')
    expect(formatHm(5 * 60_000)).toBe('0:05')
    expect(formatHm(10 * H + 59_999)).toBe('10:00')
  })
})

describe('formatKmValue', () => {
  it('is the number part of formatDistance', () => {
    expect(formatKmValue(64_300)).toBe('64')
    expect(formatKmValue(6_420)).toBe('6.4')
    expect(formatKmValue(0)).toBe('0')
    expect(formatKmValue(-5)).toBe('0')
    expect(formatKmValue(NaN)).toBe('0')
    expect(formatKmValue(Infinity)).toBe('0')
  })
})

describe('formatDistance', () => {
  it('rounds to whole km from 10 km, one decimal below', () => {
    expect(formatDistance(41_200)).toBe('41 km')
    expect(formatDistance(6_420)).toBe('6.4 km')
    expect(formatDistance(9_990)).toBe('10 km')
    expect(formatDistance(0)).toBe('0 km')
  })
})

describe('formatClock', () => {
  it('shows local 24 h time zero padded', () => {
    expect(formatClock(utc('2026-10-08T05:20:00Z'), MAK)).toBe('13:20')
    expect(formatClock(utc('2026-10-07T16:05:00Z'), MAK)).toBe('00:05')
    expect(formatClock(utc('2026-10-08T05:20:00Z'), 'UTC')).toBe('05:20')
  })
})

describe('formatAge', () => {
  it('picks the unit', () => {
    expect(formatAge(0)).toBe('0 s ago')
    expect(formatAge(999)).toBe('0 s ago')
    expect(formatAge(-3000)).toBe('0 s ago')
    expect(formatAge(4_000)).toBe('4 s ago')
    expect(formatAge(59_999)).toBe('59 s ago')
    expect(formatAge(60_000)).toBe('1 min ago')
    expect(formatAge(2 * H)).toBe('2 h ago')
    expect(formatAge(3 * 24 * H)).toBe('3 d ago')
  })
})

describe('day labels', () => {
  it('formats the long and short day', () => {
    const t = utc('2026-10-08T05:20:00Z')
    expect(formatDayLabel(t, MAK)).toBe('Thu 8 Oct 2026')
    expect(formatShortDay(utc('2026-10-02T05:00:00Z'), MAK)).toBe('Fri 2')
  })
  it('uses the local day, not the UTC day', () => {
    const t = utc('2026-10-07T18:00:00Z') // 02:00 on the 8th in Makassar
    expect(formatDayLabel(t, MAK)).toBe('Thu 8 Oct 2026')
    expect(formatDayLabel(t, 'UTC')).toBe('Wed 7 Oct 2026')
  })
})

describe('dayBounds / addDays', () => {
  it('is a 24 h day in a zone without DST', () => {
    const b = dayBounds(utc('2026-10-08T05:20:00Z'), MAK)
    expect(b.start).toBe(utc('2026-10-07T16:00:00Z'))
    expect(b.end).toBe(utc('2026-10-08T16:00:00Z'))
  })
  it('start is inclusive, end exclusive', () => {
    const b = dayBounds(utc('2026-10-07T16:00:00Z'), MAK)
    expect(b.start).toBe(utc('2026-10-07T16:00:00Z'))
    expect(dayBounds(b.end - 1, MAK)).toEqual(b)
    expect(dayBounds(b.end, MAK).start).toBe(b.end)
  })
  it('Europe/Berlin spring forward is a 23 h day', () => {
    const b = dayBounds(utc('2026-03-29T10:00:00Z'), 'Europe/Berlin')
    expect(b.start).toBe(utc('2026-03-28T23:00:00Z'))
    expect(b.end).toBe(utc('2026-03-29T22:00:00Z'))
    expect(b.end - b.start).toBe(23 * H)
  })
  it('Europe/Berlin fall back is a 25 h day', () => {
    const b = dayBounds(utc('2026-10-25T10:00:00Z'), 'Europe/Berlin')
    expect(b.start).toBe(utc('2026-10-24T22:00:00Z'))
    expect(b.end).toBe(utc('2026-10-25T23:00:00Z'))
    expect(b.end - b.start).toBe(25 * H)
  })
  it('America/New_York transitions', () => {
    const spring = dayBounds(utc('2026-03-08T15:00:00Z'), 'America/New_York')
    expect(spring.end - spring.start).toBe(23 * H)
    expect(spring.start).toBe(utc('2026-03-08T05:00:00Z'))
    const fall = dayBounds(utc('2026-11-01T15:00:00Z'), 'America/New_York')
    expect(fall.end - fall.start).toBe(25 * H)
    expect(fall.start).toBe(utc('2026-11-01T04:00:00Z'))
  })
  it('addDays steps by calendar days across DST and in both directions', () => {
    const tz = 'Europe/Berlin'
    const sat = dayBounds(utc('2026-03-28T12:00:00Z'), tz).start
    const sun = addDays(sat, 1, tz)
    expect(sun).toBe(utc('2026-03-28T23:00:00Z'))
    expect(addDays(sat, 2, tz)).toBe(utc('2026-03-29T22:00:00Z'))
    expect(addDays(addDays(sat, 2, tz), -2, tz)).toBe(sat)
    expect(addDays(sat, 0, tz)).toBe(sat)
    expect(addDays(utc('2026-10-07T16:00:00Z'), 7, MAK)).toBe(utc('2026-10-14T16:00:00Z'))
  })
  it('addDays crosses month and year ends', () => {
    const start = dayBounds(utc('2026-12-31T05:00:00Z'), MAK).start
    expect(formatDayLabel(addDays(start, 1, MAK), MAK)).toBe('Fri 1 Jan 2027')
    expect(formatDayLabel(addDays(start, -31, MAK), MAK)).toBe('Mon 30 Nov 2026')
  })
})

describe('atLocalHour', () => {
  it('returns the wall-clock hour, also on DST days', () => {
    const tz = 'Europe/Berlin'
    const dayStart = dayBounds(utc('2026-03-29T10:00:00Z'), tz).start
    expect(atLocalHour(dayStart, 6, tz)).toBe(utc('2026-03-29T04:00:00Z')) // 06:00 CEST, only 5 h after midnight
    expect(atLocalHour(dayStart, 18, tz)).toBe(utc('2026-03-29T16:00:00Z'))
    expect(atLocalHour(dayStart, 6.5, tz)).toBe(utc('2026-03-29T04:30:00Z'))
  })
})
