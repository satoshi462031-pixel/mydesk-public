// どこからも参照されなくなったデスク写真の実ファイルを片付ける。
//
// 写真の実ファイルが消えるのは、デスクの削除（deletePlanImages）と写真1枚の削除だけ。
// バックアップから戻す・復元を取り消す・別の端末で消したデスクを取り込む、では
// 置き換わったデスクの写真がどのデスクからも参照されないまま plan_images/ に残り続けた。
//
// 消す判定は「端末に保存しているどこにも名前が出てこない」こと。デスク本体に限らず、
// 取り消し用の控え・復元途中の記録・作成途中の下書き・削除の後始末の控えなど、
// 写真を指しうる値を全部まとめて見る。どれか1つにでも名前があれば残す
// （判定を誤ると利用者の写真を戻せない形で失う。残しすぎるほうがまし）。
//
// さらに、1回見つけただけでは消さない。初めて見つけた時刻を控え、24時間後の掃除でも
// まだどこにも出てこなければ消す。取り込み・複製の直後でデスクの保存が終わっていない
// 写真を消さないため（複製はコピー元の更新日時を引き継ぐので、ファイルの日時では判断できない）。
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import { PLAN_IMAGE_DIR } from '../utils/planImages'

export const PLAN_IMAGE_SWEEP_KEY = '@plan_image_sweep_candidates_v1'
const GRACE_MS = 24 * 60 * 60 * 1000

const REFERENCE = /plan_images\/([A-Za-z0-9_.-]+?\.jpg)/gi

/** 縮小版（_thumb / _md）は本体の名前で数える */
function masterName(name: string): string {
  return name.replace(/_(thumb|md)\.jpg$/i, '.jpg')
}

async function referencedNames(): Promise<Set<string>> {
  const keys = await AsyncStorage.getAllKeys()
  const entries = await AsyncStorage.multiGet(keys)
  const names = new Set<string>()
  for (const [, value] of entries) {
    if (!value || !value.includes('plan_images/')) continue
    for (const match of value.matchAll(REFERENCE)) names.add(masterName(match[1]))
  }
  return names
}

function parseCandidates(raw: string | null): Record<string, number> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
  } catch {
    return {}
  }
}

let sweeping: Promise<number> | null = null

/**
 * 消した枚数を返す。参照を読めなければ何も消さずに投げる
 * （読めないと全部が孤児に見える）。
 */
export function sweepUnreferencedPlanImages(now = Date.now()): Promise<number> {
  sweeping ??= (async () => {
    let files: string[]
    try {
      files = await FileSystem.readDirectoryAsync(PLAN_IMAGE_DIR)
    } catch {
      return 0 // 写真を一度も取り込んでいない
    }
    const referenced = await referencedNames()
    const previous = parseCandidates(await AsyncStorage.getItem(PLAN_IMAGE_SWEEP_KEY))
    const next: Record<string, number> = {}
    let deleted = 0
    for (const name of files) {
      if (referenced.has(masterName(name))) continue
      const firstSeen = previous[name]
      if (firstSeen === undefined || now - firstSeen < GRACE_MS) {
        next[name] = firstSeen ?? now
        continue
      }
      await FileSystem.deleteAsync(PLAN_IMAGE_DIR + name, { idempotent: true })
        .then(() => { deleted += 1 })
        .catch(() => { next[name] = firstSeen })
    }
    if (Object.keys(next).length > 0) await AsyncStorage.setItem(PLAN_IMAGE_SWEEP_KEY, JSON.stringify(next))
    else await AsyncStorage.removeItem(PLAN_IMAGE_SWEEP_KEY)
    return deleted
  })().finally(() => { sweeping = null })
  return sweeping
}
