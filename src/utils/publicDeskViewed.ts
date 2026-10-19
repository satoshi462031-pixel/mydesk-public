import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = '@public_desk_viewed_v1'

export type PublicDeskViewedMap = Record<string, string>

export async function loadPublicDeskViewed(): Promise<PublicDeskViewedMap> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

/** 詳細を実際に開いた時点の内容更新時刻を保存する。 */
export async function markPublicDeskViewed(deskId: string, contentStamp: string): Promise<void> {
  await AsyncStorage.mergeItem(KEY, JSON.stringify({ [deskId]: contentStamp })).catch(() => {})
}
