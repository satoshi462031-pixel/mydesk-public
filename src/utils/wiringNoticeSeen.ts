// 配線図の断り（自動生成なので実物と違うことがある）を、アプリ全体で初回だけ出すための記録。
//
// 毎回出すと数回で読み飛ばされ、常設にすると図が縦に縮む。デスクを作った直後の
// 1回だけ効けばよい性質。過去版が保存したデスク id の配列も、1件あれば既読として使う。
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = '@wiring_notice_seen'

export async function loadWiringNoticeSeen(): Promise<ReadonlySet<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    // 読めなければ断りが1回多く出るだけ。害が無いほうへ倒す
    return new Set()
  }
}

export async function markWiringNoticeSeen(planId: string): Promise<void> {
  const seen = await loadWiringNoticeSeen()
  if (seen.has(planId)) return
  await AsyncStorage.setItem(KEY, JSON.stringify([...seen, planId])).catch(() => {})
}
