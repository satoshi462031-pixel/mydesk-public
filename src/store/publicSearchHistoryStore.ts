import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizePublicDeskSearch } from '../utils/publicDeskFeed'
import { serializeLocalDataOperation } from '../utils/localDataOperation'

export const PUBLIC_SEARCH_HISTORY_PREFIX = '@public_search_history_v1:'
export const PUBLIC_SEARCH_HISTORY_LIMIT = 5

const keyFor = (userId: string | null) => PUBLIC_SEARCH_HISTORY_PREFIX + (userId ?? 'guest')

function parseHistory(raw: string | null): string[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(value)) return []
    const queries: string[] = []
    const seen = new Set<string>()
    for (const item of value) {
      if (typeof item !== 'string') continue
      const query = normalizePublicDeskSearch(item)
      const key = query.toLowerCase()
      if (!query || seen.has(key)) continue
      seen.add(key)
      queries.push(query)
      if (queries.length === PUBLIC_SEARCH_HISTORY_LIMIT) break
    }
    return queries
  } catch { return [] }
}

export function loadPublicSearchHistory(userId: string | null): Promise<string[]> {
  return serializeLocalDataOperation(async isCurrent => {
    if (!isCurrent()) return []
    return parseHistory(await AsyncStorage.getItem(keyFor(userId)))
  })
}

export function recordPublicSearch(query: string, userId: string | null): Promise<string[]> {
  return serializeLocalDataOperation(async isCurrent => {
    if (!isCurrent()) return []
    const key = keyFor(userId)
    const history = parseHistory(await AsyncStorage.getItem(key))
    const normalized = normalizePublicDeskSearch(query)
    if (!normalized || !isCurrent()) return history
    const next = parseHistory(JSON.stringify([normalized, ...history]))
    await AsyncStorage.setItem(key, JSON.stringify(next))
    return next
  })
}

export function clearPublicSearchHistory(userId: string | null): Promise<void> {
  // ログアウトの削除より後に、古い画面の保存が戻ってこないよう同じ列で処理する。
  return serializeLocalDataOperation(async isCurrent => {
    if (isCurrent()) await AsyncStorage.removeItem(keyFor(userId))
  })
}
