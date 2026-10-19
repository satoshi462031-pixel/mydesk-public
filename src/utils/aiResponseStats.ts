export interface AIResponseStats {
  firstResponseMs?: number
  totalMs?: number
  stopped?: boolean
}

export function aiResponseStatsLabel(
  content: string,
  stats: AIResponseStats | undefined,
  lang: 'ja' | 'en',
  streaming = false,
): string | null {
  if (!stats || typeof stats !== 'object') return null
  const parts: string[] = []
  if (streaming) parts.push(lang === 'ja' ? '回答中' : 'Generating')
  else if (stats.stopped) parts.push(lang === 'ja' ? '停止' : 'Stopped')
  const duration = (value: number | undefined, ja: string, en: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return
    parts.push(lang === 'ja' ? `${ja} ${(value / 1000).toFixed(1)}秒` : `${en} ${(value / 1000).toFixed(1)}s`)
  }
  duration(stats.firstResponseMs, '待機', 'Wait')
  duration(stats.totalMs, '全体', 'Total')
  const count = Array.from(content).length.toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US')
  parts.push(lang === 'ja' ? `${count}文字` : `${count} characters`)
  return parts.join(' · ')
}
