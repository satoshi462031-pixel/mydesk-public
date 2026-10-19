// 他人の公開デスクを見た履歴（マイページの「履歴」タブ）。ログイン中の控えにも含めて復元する。
// 既読の記録（publicDeskViewed / bookmarkSeen）は内容の時刻しか持たず、見た順番が無いので別に持つ。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { STORAGE_TIMEOUT_MS, withTimeout } from './networkError'

export const VIEW_HISTORY_KEY = '@desk_view_history_v1'
export const VIEW_HISTORY_LIMIT = 100
export const VIEW_HISTORY_STORAGE_LIMIT = 1000

export interface ViewHistoryEntry {
  deskId: string
  viewedAt: string
}

export function isViewHistoryEntry(value: unknown): value is ViewHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<ViewHistoryEntry>
  return typeof entry.deskId === 'string' && entry.deskId.length > 0
    && typeof entry.viewedAt === 'string' && Number.isFinite(Date.parse(entry.viewedAt))
}

export function mergeViewHistory(account: readonly ViewHistoryEntry[], local: readonly ViewHistoryEntry[]): ViewHistoryEntry[] {
  const seen = new Set<string>()
  return [...account, ...local]
    .sort((a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt))
    .filter((entry) => seen.has(entry.deskId) ? false : (seen.add(entry.deskId), true))
    .slice(0, VIEW_HISTORY_STORAGE_LIMIT)
    .map(({ deskId, viewedAt }) => ({ deskId, viewedAt }))
}

/** 見たデスクを先頭へ。前にも見ていれば元の位置から抜いて、最新の1件にする */
export function addToViewHistory(
  history: readonly ViewHistoryEntry[],
  deskId: string,
  viewedAt: string,
  limit = VIEW_HISTORY_LIMIT,
): ViewHistoryEntry[] {
  return [{ deskId, viewedAt }, ...history.filter((entry) => entry.deskId !== deskId)].slice(0, limit)
}

function parse(raw: string | null): ViewHistoryEntry[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isViewHistoryEntry)
  } catch {
    return []
  }
}

// ストレージの読み込み失敗は例外のまま運ぶ。空として扱うと、一覧は「まだありません」と言い、
// 次の記録は空に1件足して書き戻すので、それまでの履歴が全部消える
async function readHistory(): Promise<ViewHistoryEntry[]> {
  return parse(await AsyncStorage.getItem(VIEW_HISTORY_KEY))
}

/** 書き込み待ちの記録・削除を済ませてから読む。直前に × で消した1件が戻らないように */
export async function loadViewHistory(): Promise<ViewHistoryEntry[]> {
  await queue
  return readHistory()
}

// 読んで足して書く間に次の記録が割り込むと、先の1件が消える（デスクから似たデスクへ続けて開いたとき）
let queue: Promise<void> = Promise.resolve()
let generation = 0

export async function flushViewHistoryPersistence(): Promise<void> {
  await withTimeout(queue, STORAGE_TIMEOUT_MS)
}

/** 復元・ログアウト後へ、以前の読み取りと書き込みを持ち越さない。 */
export async function cancelPendingViewHistoryUpdates(): Promise<void> {
  generation += 1
  await flushViewHistoryPersistence()
}

/** 表示用の修復で消えた項目を、空の控えとして保存しない。 */
export async function readViewHistoryForBackup(): Promise<ViewHistoryEntry[]> {
  await flushViewHistoryPersistence()
  const raw = await withTimeout(AsyncStorage.getItem(VIEW_HISTORY_KEY), STORAGE_TIMEOUT_MS)
  if (raw === null) return []
  let entries: unknown
  try { entries = JSON.parse(raw) } catch { throw new Error('LOCAL_BACKUP_DATA_INVALID') }
  if (!Array.isArray(entries) || !entries.every(isViewHistoryEntry)) throw new Error('LOCAL_BACKUP_DATA_INVALID')
  return mergeViewHistory([], entries)
}

function update(change: (history: ViewHistoryEntry[]) => ViewHistoryEntry[]): Promise<void> {
  const started = generation
  queue = queue.then(async () => {
    if (started !== generation) return
    const next = change(await readHistory())
    if (started !== generation) return
    await AsyncStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(next))
  }).catch(() => {})
  return queue
}

export function recordDeskView(deskId: string, viewedAt = new Date().toISOString(), limit = VIEW_HISTORY_LIMIT): Promise<void> {
  // 解約・権利確認中でも保有済みの履歴を一度に削らない。無料へ戻った後は保有数を増やさず循環する。
  return update((history) => addToViewHistory(history, deskId, viewedAt,
    Math.min(VIEW_HISTORY_STORAGE_LIMIT, Math.max(limit, history.length))))
}

export function removeFromViewHistory(deskId: string): Promise<void> {
  return update((history) => history.filter((entry) => entry.deskId !== deskId))
}

export function clearViewHistory(): Promise<void> {
  return update(() => [])
}
