// デスクを消したあとの後始末（公開データ・写真・デスクごとの記録）の控え。
//
// 後始末は Undo の期限が切れてから走る（useDeskActions）。期限前にアプリを終了されたり、
// 圏外で公開データの削除に失敗したりすると、それきり誰も呼ばない。端末には写真が、
// サーバーには非公開になったデスクの行（中身の全文）と写真が残り続けていた。
// 削除の時点で控えを書き、済んだら消す。残っていれば次に一覧を開いたときにやり直す。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearProductFillDraft } from '../store/firstSetupStore'
import { getPlanById } from '../store/planStore'
import { forgetDeskCompletionPrompt } from '../utils/deskCompletionPrompt'
import { deletePlanImages } from '../utils/planImages'
import { forgetDismissedSuggestions } from '../utils/wiringSuggestionDismissal'
import { deletePublishedPlanData } from './publishService'

export const PENDING_DESK_CLEANUPS_KEY = '@pending_desk_cleanups_v1'

type PendingCleanup = { images: string[]; queuedAt: string }

// Undo の猶予（5秒）より十分長く。猶予中の削除を、別の画面のやり直しが先に確定させない
const RESUME_AFTER_MS = 60_000

async function loadAll(): Promise<Record<string, PendingCleanup>> {
  const raw = await AsyncStorage.getItem(PENDING_DESK_CLEANUPS_KEY)
  const parsed: unknown = raw ? JSON.parse(raw) : null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const result: Record<string, PendingCleanup> = {}
  for (const [planId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Partial<PendingCleanup> | null
    if (!entry || typeof entry.queuedAt !== 'string') continue
    result[planId] = {
      images: Array.isArray(entry.images) ? entry.images.filter((uri): uri is string => typeof uri === 'string') : [],
      queuedAt: entry.queuedAt,
    }
  }
  return result
}

// 読み書きを1本に並べる。同時に足し引きすると、後から書いた側が先の控えを消す
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}

export function queueDeskCleanup(planId: string, images: readonly string[]): Promise<void> {
  return serialized(async () => {
    const all = await loadAll().catch(() => ({}))
    await AsyncStorage.setItem(PENDING_DESK_CLEANUPS_KEY, JSON.stringify({
      ...all, [planId]: { images: [...images], queuedAt: new Date().toISOString() },
    }))
  })
}

export function cancelDeskCleanup(planId: string): Promise<void> {
  return serialized(async () => {
    const all = await loadAll()
    if (!(planId in all)) return
    delete all[planId]
    await AsyncStorage.setItem(PENDING_DESK_CLEANUPS_KEY, JSON.stringify(all))
  })
}

/** 後始末の本体。どれかが失敗したら投げ、控えは残す（次にやり直す） */
export async function runDeskCleanup(planId: string, images: readonly string[]): Promise<void> {
  await Promise.all([
    deletePublishedPlanData(planId),
    deletePlanImages(planId, [...images]),
    AsyncStorage.removeItem(`@desk_history:${planId}`),
    // 商品割り当ての下書きはデスク単位（キーの持ち主は firstSetupStore）
    clearProductFillDraft(planId),
    forgetDeskCompletionPrompt(planId),
    forgetDismissedSuggestions(planId),
  ])
  await cancelDeskCleanup(planId)
}

let resuming: Promise<void> | null = null

/** 済んでいない後始末をやり直す。失敗したものは控えを残して次回へ回す */
export function resumePendingDeskCleanups(now = Date.now()): Promise<void> {
  resuming ??= (async () => {
    const all = await loadAll().catch(() => ({} as Record<string, PendingCleanup>))
    for (const [planId, entry] of Object.entries(all)) {
      if (now - Date.parse(entry.queuedAt) < RESUME_AFTER_MS) continue
      // Undo で戻したのに控えを消せなかった場合。デスクがあるうちは何も消さない。
      // 読めなかっただけの場合も「残っている」側に倒す（写真を消すと戻せない）
      const plan = await getPlanById(planId).catch(() => true)
      if (plan) {
        if (plan !== true) await cancelDeskCleanup(planId).catch(() => {})
        continue
      }
      await runDeskCleanup(planId, entry.images).catch(() => {})
    }
  })().finally(() => { resuming = null })
  return resuming
}
