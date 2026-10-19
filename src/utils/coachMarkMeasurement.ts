import type { CoachRect } from './coachMarkLayout'

export interface CoachMeasurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void
}

export function measureCoachTarget(node: CoachMeasurable | null | undefined, timeoutMs = 400): Promise<CoachRect | null> {
  return new Promise((resolve) => {
    if (!node) return resolve(null)
    let settled = false
    const done = (rect: CoachRect | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(rect)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    try {
      node.measureInWindow((x, y, width, height) => {
        done([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
          ? { x, y, width, height } : null)
      })
    } catch {
      // 遷移で外れたネイティブ要素は測定を投げることがある。案内だけ閉じ、画面操作を続ける。
      done(null)
    }
  })
}
