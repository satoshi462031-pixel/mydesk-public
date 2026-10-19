// 配線の登録漏れの確認（WiringResultScreen の suggestions）を、デスクごとに閉じた記録。
//
// 閉じたのはその時点の「足りないもの」に対して。あとで機材を足して別のものが
// 足りなくなったときは出したいので、デスク単位ではなく足りないものの組ごとに覚える。
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { WiringSuggestion } from '../types'

const KEY = '@wiring_suggestion_dismissed_v1'

export function suggestionKey(item: Pick<WiringSuggestion, 'category' | 'reason'>): string {
  return `${item.category}:${item.reason}`
}

async function loadAll(): Promise<Record<string, string[]>> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function loadDismissedSuggestions(planId: string): Promise<ReadonlySet<string>> {
  const keys = (await loadAll())[planId]
  return new Set(Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [])
}

/** デスクを消したときに、そのデスクの記録を消す。残すとデスクの数だけ溜まり続ける */
export async function forgetDismissedSuggestions(planId: string): Promise<void> {
  const all = await loadAll()
  if (!(planId in all)) return
  const rest = { ...all }
  delete rest[planId]
  await AsyncStorage.setItem(KEY, JSON.stringify(rest))
}

export async function dismissWiringSuggestions(planId: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  const all = await loadAll()
  const merged = [...new Set([...(Array.isArray(all[planId]) ? all[planId] : []), ...keys])]
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...all, [planId]: merged })).catch(() => {})
}
