import AsyncStorage from '@react-native-async-storage/async-storage'
import { ACCENT_PRESETS, AccentKey } from '../constants/accentColors'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppearancePreferences {
  themeMode?: ThemeMode
  accentKey?: AccentKey
}

let pendingWrite: Promise<void> = Promise.resolve()
const listeners = new Set<(preferences: AppearancePreferences) => void>()

export function parseAppearancePreferences(value: unknown): AppearancePreferences | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const result: AppearancePreferences = {}
  if (raw.themeMode === 'light' || raw.themeMode === 'dark' || raw.themeMode === 'system') result.themeMode = raw.themeMode
  if (ACCENT_PRESETS.some(preset => preset.key === raw.accentKey)) result.accentKey = raw.accentKey as AccentKey
  return result.themeMode || result.accentKey ? result : undefined
}

export async function readAppearancePreferences(): Promise<AppearancePreferences> {
  // 設定変更の直後にログアウトしても、保存待ちの色を控えから落とさない。
  await pendingWrite
  const entries = await AsyncStorage.multiGet(['app_theme', 'app_accent'])
  const preferences = parseAppearancePreferences({ themeMode: entries[0][1], accentKey: entries[1][1] })
  return { themeMode: preferences?.themeMode ?? 'system', accentKey: preferences?.accentKey ?? 'orange' }
}

export function saveAppearancePreferences(preferences: AppearancePreferences): Promise<void> {
  const valid = parseAppearancePreferences(preferences)
  const entries: [string, string][] = []
  if (valid?.themeMode) entries.push(['app_theme', valid.themeMode])
  if (valid?.accentKey) entries.push(['app_accent', valid.accentKey])
  if (!entries.length) return Promise.resolve()
  const run = pendingWrite.catch(() => {}).then(() => AsyncStorage.multiSet(entries))
  pendingWrite = run
  return run
}

export async function restoreAppearancePreferences(value: unknown): Promise<void> {
  const preferences = parseAppearancePreferences(value)
  if (!preferences) return
  await saveAppearancePreferences(preferences)
  // AppProvider はログインで再マウントされないので、ディスクへ戻しただけでは画面が変わらない。
  notifyAppearancePreferences(preferences)
}

export function subscribeAppearancePreferences(listener: (preferences: AppearancePreferences) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyAppearancePreferences(preferences: AppearancePreferences): void {
  listeners.forEach(listener => listener(preferences))
}

export async function flushAppearancePersistence(): Promise<void> {
  const current = pendingWrite
  await current.catch(() => {})
  // 生の退避を書き戻した後に、巻き戻した設定の古い保存失敗で読み取りを止めない。
  if (pendingWrite === current) pendingWrite = Promise.resolve()
}
