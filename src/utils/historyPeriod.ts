// 履歴の区切り（マイページの「履歴」）。YouTube の再生履歴と同じく、日ごとに見出しを立てる。
// 今日・昨日のあとは、1週間以内なら曜日、それより前は日付で読む（「3日前」は数え直さないと
// どの日か分からないが、曜日なら「月曜に見たデスク」と思い出せる）。

const WEEKDAYS_JA = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 端末の暦日で数えた、今日からの日数。未来の時刻（端末の時計ずれ）は今日に寄せる */
function daysAgo(date: Date, now: Date): number {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  return Math.max(0, Math.round((day(now) - day(date)) / 86_400_000))
}

/** 同じ見出しに入るかを決める鍵（端末の暦日）。無効な日時は null */
export function historyDayKey(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function historyPeriodLabel(iso: string, lang: 'ja' | 'en', now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = daysAgo(date, now)
  if (diff === 0) return lang === 'en' ? 'Today' : '今日'
  if (diff === 1) return lang === 'en' ? 'Yesterday' : '昨日'
  if (diff < 7) return (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_JA)[date.getDay()]
  const sameYear = date.getFullYear() === now.getFullYear()
  if (lang === 'en') {
    const monthDay = `${MONTHS_EN[date.getMonth()]} ${date.getDate()}`
    return sameYear ? monthDay : `${monthDay}, ${date.getFullYear()}`
  }
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`
  return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`
}

/** 新しい順に並んだ項目を、日ごとの見出しで区切る。並び順は変えない */
export function groupHistoryByDay<T>(
  items: readonly T[],
  timeOf: (item: T) => string,
  lang: 'ja' | 'en',
  now = new Date(),
): { label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = []
  for (const item of items) {
    const key = historyDayKey(timeOf(item)) ?? 'unknown'
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.items.push(item)
    } else {
      groups.push({ key, label: historyPeriodLabel(timeOf(item), lang, now), items: [item] })
    }
  }
  return groups.map(({ label, items: grouped }) => ({ label, items: grouped }))
}
