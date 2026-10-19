// 更新一覧の材料。保存したデスクと、フォロー中の人（084）の公開デスクを読む。
// 「何が変わったか」まで出すので share_snapshot ごと要る（ベルの点だけなら
// services/desks.ts の listWatchedDeskStamps と userFollows.listFollowedDeskStamps を使う）。
//
// いいねは見ない。いいねは投稿者へ反応を送る操作で、押した本人が
// あとから辿る場所を持たない（マイページのタブは公開・保存・ガジェットの3つ）。
// 監視の対象に入れると、押した先が無いのに更新だけ通知されることになる。
// あとで見るために取っておくのは保存のほう、人を追うのはフォローのほう。
import { DeskWithDetails } from '../supabase/types'
import { getBookmarkedDesks } from './desks'
import { getBlockedUserIds } from './moderationService'
import { listFollowedDesks, listFollowedUserIds } from './userFollows'

export interface WatchedDesks {
  desks: DeskWithDetails[]
  /** ブロックした相手を除いたフォロー中の人。既読同期（syncSeen）にそのまま渡す */
  followees: string[]
}

export async function loadWatchedDesks(userId: string): Promise<WatchedDesks> {
  const [bookmarks, blockedIds, followeeIds] = await Promise.all([
    getBookmarkedDesks(userId),
    getBlockedUserIds(),
    listFollowedUserIds(userId),
  ])
  // ブロックした相手は「追っていない」扱いにする。追っている記録に残すと、
  // 解除した瞬間にその人の既存デスクが全部「新しいデスク」として並ぶ
  const followees = followeeIds.filter((id) => !blockedIds.has(id))
  const followed = await listFollowedDesks(followees)
  const byId = new Map<string, DeskWithDetails>()
  for (const desk of [...bookmarks.map((row) => row.desk), ...followed]) {
    // ブロックした相手のデスクは出さない（ガイドライン 1.2）。
    // 公開を取り消されたデスクも伝えない（開いても見られない）
    if (!desk || blockedIds.has(desk.user_id) || desk.visibility !== 'public') continue
    byId.set(desk.id, desk)
  }
  return { desks: [...byId.values()], followees }
}
