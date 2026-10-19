import type { TimelineEvent, TimelineYearlyChange } from './deskTimeline'
import { localizedGadgetName } from './localizedGadgetName'
import { gadgetCategoryKey } from './customCategory'

export const HISTORY_DETAIL_ITEM_LIMIT = 12

export function isBulkHistoryChange(inCount: number, outCount: number): boolean {
  return inCount + outCount > HISTORY_DETAIL_ITEM_LIMIT
}

export function historyChangePageCount(inCount: number, outCount: number, pageSize: number): number {
  if (isBulkHistoryChange(inCount, outCount)) return 1
  return Math.max(1, Math.ceil((outCount + inCount) / pageSize))
}

export function historyYearlyChangeLabel(group: TimelineYearlyChange, lang: 'ja' | 'en'): string {
  return lang === 'ja' ? `年内に${group.changeCount}回変更` : `${group.changeCount} changes this year`
}

export function historyChangeLabel(event: TimelineEvent | undefined, lang: 'ja' | 'en'): string {
  if (!event) return ''
  const ja = lang === 'ja'
  if (event.isTodayPage) return ja ? '現在のデスク' : 'Your desk today'
  const parts: string[] = []
  const summarized = new Set(event.yearlyChanges?.map((group) => group.categoryKey))
  for (const [allGadgets, added] of [[event.inGadgets, true], [event.outGadgets, false]] as const) {
    const gadgets = allGadgets.filter((g) => !summarized.has(gadgetCategoryKey(g)))
    if (!gadgets.length) continue
    const name = gadgets.length === 1 ? localizedGadgetName(gadgets[0], lang) : ja ? `${gadgets.length}件` : `${gadgets.length} items`
    parts.push(ja ? `${name}を${added ? '追加' : '撤去'}` : `${added ? 'Added' : 'Removed'} ${name}`)
  }
  if (event.modeChanges.some(({ gadget }) => !summarized.has(gadgetCategoryKey(gadget)))) parts.push(ja ? '使用方法を変更' : 'Usage changed')
  for (const group of event.yearlyChanges ?? []) parts.push(historyYearlyChangeLabel(group, lang))
  return parts.join(' / ') || (ja ? 'デスクの構成' : 'Desk setup')
}
