import { getDeskWithDetails } from '../services/desks'
import { DeskWithDetails } from '../supabase/types'

// ─── 公開デスクの取得結果キャッシュ ───────────────────────────────
// 起動後の空き時間にデモデスクを先読みしておき、開いたときに通信待ちの
// スケルトンを出さずに済むようにする。
// 取得結果は変わりうるので、使うときは即座にキャッシュを返したうえで
// 画面側が裏で再取得する（useDeskDetail）。
// メモリのみ・セッション内だけの保持で、失敗は握りつぶす。

const TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 8

const cache = new Map<string, { desk: DeskWithDetails; at: number }>()

export function getPrefetchedDesk(deskId: string): DeskWithDetails | null {
  const hit = cache.get(deskId)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(deskId)
    return null
  }
  return hit.desk
}

/**
 * ログアウト・アカウント削除で呼ぶ。
 * このキャッシュには「自分のデスク」も入りうる（RLS は本人には非公開のデスクも返すため、
 * 自分の公開URLを開けば非公開の内容も乗る）。持ち主が変わる可能性のある端末に、
 * 前の利用者の中身を残さない。
 */
export function clearPrefetchedDesks(): void {
  cache.clear()
}

/**
 * 取り直したら無かった（非公開・削除）ときに呼ぶ。残すと次に開いた瞬間に
 * 前の内容が出てから「見つかりません」に変わる
 */
export function dropPrefetchedDesk(deskId: string): void {
  cache.delete(deskId)
}

export function putPrefetchedDesk(deskId: string, desk: DeskWithDetails): void {
  // 限定リンクは開くたびに有効性を確認し、失効後にキャッシュを先に見せない。
  if (desk.visibility === 'unlisted') { cache.delete(deskId); return }
  cache.set(deskId, { desk, at: Date.now() })
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** 先読み。すでに新しいキャッシュがあれば通信しない。失敗時は null */
export async function prefetchDeskDetail(deskId: string): Promise<DeskWithDetails | null> {
  const cached = getPrefetchedDesk(deskId)
  if (cached) return cached
  try {
    const desk = await getDeskWithDetails(deskId)
    if (!desk) return null
    putPrefetchedDesk(deskId, desk)
    return desk
  } catch {
    return null
  }
}
