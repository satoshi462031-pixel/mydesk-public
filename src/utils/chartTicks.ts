export function niceTicks(max: number, count = 4): { ticks: number[]; top: number } {
  if (!Number.isFinite(max) || !(max > 0)) return { ticks: [0], top: 1 }
  const divisions = Number.isFinite(count) && count >= 1 ? Math.min(20, Math.floor(count)) : 4
  const mag = Math.pow(10, Math.floor(Math.log10(max / divisions)))
  const norm = max / divisions / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  // 公開JSONの極小値でstepが0になると、加算で進めるループが終わらない。
  if (!Number.isFinite(step) || !(step > 0)) return { ticks: [0, max], top: max }
  let top = Math.ceil(max / step) * step
  if (top - max < step * 1e-6) top += step
  if (!Number.isFinite(top)) return { ticks: [0, max], top: max }
  const ticks: number[] = []
  for (let index = 0; index <= divisions + 1; index++) {
    const value = index * step
    if (!Number.isFinite(value) || value > top + step / 1000) break
    ticks.push(value)
  }
  return { ticks, top }
}
