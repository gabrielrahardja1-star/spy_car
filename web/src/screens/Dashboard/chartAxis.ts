const TICK_COUNT = 4

/** Y-axis for the bar chart: three equal steps (a multiple of 10 km) from 0, so the 4 ticks are whole numbers. */
export function chartAxis(maxKm: number): { ticks: number[]; max: number } {
  const top = Number.isFinite(maxKm) && maxKm > 0 ? maxKm : 0
  const step = Math.max(10, Math.ceil(top / (TICK_COUNT - 1) / 10) * 10)
  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => (TICK_COUNT - 1 - i) * step)
  return { ticks, max: ticks[0] }
}
