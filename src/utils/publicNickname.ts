import AsyncStorage from '@react-native-async-storage/async-storage'
import { trimAndTruncate, truncateChars } from './truncateText'

export const PUBLIC_NICKNAME_KEY = 'public_nickname'
const LEGACY_DESK_NAME_KEY = 'desk_name'
const LEGACY_DEFAULT_NAMES = new Set(['マイデスク', 'My Desk', 'MyDesk'])

/** 旧「デスク名」のカスタム値だけを公開ニックネームとして引き継ぐ。 */
export async function getPublicNickname(): Promise<string> {
  const current = await AsyncStorage.getItem(PUBLIC_NICKNAME_KEY)
  if (current !== null) return trimAndTruncate(current, 20)

  const legacy = (await AsyncStorage.getItem(LEGACY_DESK_NAME_KEY))?.trim() ?? ''
  if (legacy && !LEGACY_DEFAULT_NAMES.has(legacy)) {
    const migrated = truncateChars(legacy, 20)
    await AsyncStorage.setItem(PUBLIC_NICKNAME_KEY, migrated)
    await AsyncStorage.removeItem(LEGACY_DESK_NAME_KEY)
    return migrated
  }

  if (legacy) await AsyncStorage.removeItem(LEGACY_DESK_NAME_KEY)
  return ''
}

export async function setPublicNickname(value: string): Promise<string> {
  const nickname = trimAndTruncate(value, 20)
  if (nickname) await AsyncStorage.setItem(PUBLIC_NICKNAME_KEY, nickname)
  else await AsyncStorage.removeItem(PUBLIC_NICKNAME_KEY)
  await AsyncStorage.removeItem(LEGACY_DESK_NAME_KEY)
  return nickname
}

/**
 * 端末に公開ニックネームが無いときだけ、サーバーの表示名で埋める。
 * 機種変更・再インストール直後は AsyncStorage が空で、そのまま
 * 「更新して公開」すると desks.owner_name が空で上書きされ、
 * 公開ページから投稿者名が消えるため。
 *
 * 本人が名前を消した場合は profiles.display_name も NULL になっている
 * （set_public_owner_name）ので、ここで復活することはない。
 */
export async function seedPublicNickname(displayName: string | null | undefined): Promise<void> {
  const name = displayName ? trimAndTruncate(displayName, 20) : ''
  if (!name || name.includes('@')) return
  if (await AsyncStorage.getItem(PUBLIC_NICKNAME_KEY) !== null) return
  // 旧「デスク名」からの引き継ぎを先に通す。そちらのほうが本人の直近の指定に近い
  if (await getPublicNickname()) return
  await AsyncStorage.setItem(PUBLIC_NICKNAME_KEY, name)
}
