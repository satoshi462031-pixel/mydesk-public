import type { DeskUsagePeriodDraft } from '../components/molecules/DeskUsageHistoryEditor'
import type { DeskGadgetUsageMode } from '../types'
import { formatStoredDate, parseDateInput } from './dateFormat'
import { localDateKey } from './deskTimeline'

/** 今の期間（終了日が空のうち最後のもの）。無ければこのデスクから外れている */
function currentIndex(drafts: readonly DeskUsagePeriodDraft[]): number {
  for (let i = drafts.length - 1; i >= 0; i -= 1) {
    if (!drafts[i].endedAt.trim()) return i
  }
  return -1
}

export function currentUsageMode(drafts: readonly DeskUsagePeriodDraft[]): DeskGadgetUsageMode | null {
  const index = currentIndex(drafts)
  return index < 0 ? null : drafts[index].mode
}

/**
 * デスクで「飾り」を切り替える。今の期間の向きを書き換えるのではなく、今日で区切って
 * 新しい期間を足す。書き換えると、それまで使っていた期間まで飾りだったことになり、
 * 歴史アニメと年表がさかのぼって変わる。
 * 今日始まった期間（同じ編集の中で切り替え直した・今日置いた）は向きだけ変え、
 * 今日終わった同じ向きの期間があれば繋ぎ直す（行き来しても期間が刻まれない）
 */
export function withCurrentUsageMode(
  drafts: readonly DeskUsagePeriodDraft[],
  mode: DeskGadgetUsageMode,
  lang: 'ja' | 'en',
  todayKey = localDateKey(),
): DeskUsagePeriodDraft[] {
  const index = currentIndex(drafts)
  if (index < 0 || drafts[index].mode === mode) return [...drafts]
  const current = drafts[index]
  const startedKey = parseDateInput(current.startedAt, lang)
  // 開始日が未入力・読めない・今日以降なら、区切る前の期間が無い
  if (!startedKey || startedKey >= todayKey) {
    const previous = startedKey === todayKey
      ? drafts.findIndex((draft, i) => i !== index && draft.mode === mode && parseDateInput(draft.endedAt, lang) === todayKey)
      : -1
    if (previous >= 0) {
      return drafts
        .filter((_, i) => i !== index)
        .map((draft) => draft === drafts[previous] ? { ...draft, endedAt: '' } : draft)
    }
    return drafts.map((draft, i) => i === index ? { ...draft, mode } : draft)
  }
  const today = formatStoredDate(todayKey, lang)
  return [
    ...drafts.map((draft, i) => i === index ? { ...draft, endedAt: today } : draft),
    { mode, startedAt: today, endedAt: '' },
  ]
}
