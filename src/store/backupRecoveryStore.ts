import AsyncStorage from '@react-native-async-storage/async-storage'

export const RESTORE_POINT_KEY = '@backup_restore_point'
export const RESTORE_JOURNAL_KEY = '@backup_restore_journal'
export const BACKUP_REVIEW_KEY = '@backup_recovery_pending'

const FIXED_KEYS = [
  '@desk_gadgets', '@gadget_folders', '@desk_plans', '@desk_gadgets_migration',
  '@ai_conversations_v2', '@desk_history', '@local_data_owner', '@account_sign_in_pending',
  '@backup_last_at', 'app_theme', 'app_accent',
]
// あれば退避するキー。自作ジャンルの一覧（hooks/useCustomCategories.ts）は後から足したので、
// 必須にすると前に作った退避がすべて読めない扱いになる。
// 控えの突き合わせの基点（services/backupService.ts）と、復元で捨てる作成途中の下書きも、
// 取り消しで復元前と揃って戻るようにここで退避する
const OPTIONAL_KEYS = ['@custom_categories_v1', '@backup_base', '@backup_pending', '@first_setup_draft_v1', '@desk_view_history_v1']
const PREFIXES = ['@desk_history:', '@published_desk_', '@published_visibility_', '@published_signature_', '@product_fill_draft_v1:']
const protectedKey = (key: string) => FIXED_KEYS.includes(key) || OPTIONAL_KEYS.includes(key) || PREFIXES.some(prefix => key.startsWith(prefix))

export interface RestoreSnapshot {
  kind: 'MyDeskRestorePoint'
  version: 1
  entries: [string, string | null][]
}

export function isRestoreSnapshot(value: unknown): value is RestoreSnapshot {
  if (!value || typeof value !== 'object') return false
  const raw = value as Partial<RestoreSnapshot>
  if (raw.kind !== 'MyDeskRestorePoint' || raw.version !== 1 || !Array.isArray(raw.entries)) return false
  const keys = new Set<string>()
  for (const entry of raw.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !protectedKey(entry[0])
      || (entry[1] !== null && typeof entry[1] !== 'string') || keys.has(entry[0])) return false
    keys.add(entry[0])
  }
  return FIXED_KEYS.every(key => keys.has(key))
}

export async function captureRestoreSnapshot(): Promise<RestoreSnapshot> {
  const keys = [...new Set([...FIXED_KEYS, ...(await AsyncStorage.getAllKeys()).filter(protectedKey)])]
  // 退避を読み込み用の修復に通すと、壊れた項目や写真パスが戻せなくなる。
  return { kind: 'MyDeskRestorePoint', version: 1, entries: (await AsyncStorage.multiGet(keys)).map(([key, value]) => [key, value]) }
}

export async function writeRestoreSnapshot(snapshot: RestoreSnapshot): Promise<void> {
  const existing = (await AsyncStorage.getAllKeys()).filter(protectedKey)
  const kept = new Set(snapshot.entries.filter(([, value]) => value !== null).map(([key]) => key))
  const writes = await Promise.allSettled([
    AsyncStorage.multiSet(snapshot.entries.filter((entry): entry is [string, string] => entry[1] !== null)),
    AsyncStorage.multiRemove(existing.filter(key => !kept.has(key))),
  ])
  const failure = writes.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  const actual = await AsyncStorage.multiGet(snapshot.entries.map(([key]) => key))
  if (actual.some(([key, value]) => value !== snapshot.entries.find(([saved]) => saved === key)?.[1])) {
    throw new Error('RESTORE_RECOVERY_WRITE_FAILED')
  }
}
