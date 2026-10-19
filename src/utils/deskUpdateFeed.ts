// ─── 更新一覧（ベルの中身）の組み立て ──────────────────────────────
// 対象は「自分が後で見るために取っておいたデスク」＝保存したもの。
// 見ず知らずのデスクが更新されたことに意味は無いので、みんなのデスク全体は見ない。
// いいねは相手へ反応を送る操作なので、ここには入れない。

/** bookmarkSeen.SeenMap と同じ形。この層は保存の仕組みを知らない */
type SeenMap = Record<string, string>

export interface WatchedDesk {
  id: string
  updated_at: string
  content_updated_at?: string | null
}

/** bookmarkSeen.deskUpdateStamp と同じ規則（この層は AsyncStorage を持ち込まない） */
function stampOf(desk: WatchedDesk): string {
  return desk.content_updated_at ?? desk.updated_at
}

/**
 * フォロー中の人が新しく公開したデスクに入れる既読の値。
 * 既読の記録が無いデスクは「判断材料が無い」として出さない決まりなので、
 * 新しいデスクだけはどの更新時刻よりも古い値を入れて未読として並べる。
 * 開けば markSeen が本物の時刻で上書きする
 */
export const NEW_DESK_SEEN = '1970-01-01T00:00:00.000Z'

export function isNewFollowedDesk(seen: SeenMap, deskId: string): boolean {
  return seen[deskId] === NEW_DESK_SEEN
}

/**
 * 既読同期（bookmarkSeen.syncSeen）へ渡す行。フォロー中の人のデスクにだけ ownerId を付ける。
 * 保存しただけのデスクに付けると、その人をフォローしていたときに「新しいデスク」へ化ける
 */
export function watchedSeenEntries<T extends WatchedDesk & { user_id: string }>(
  desks: readonly T[],
  followees: readonly string[],
): Array<{ deskId: string; updatedAt: string; ownerId?: string }> {
  const followed = new Set(followees)
  return desks.map((desk) => ({
    deskId: desk.id,
    updatedAt: stampOf(desk),
    ...(followed.has(desk.user_id) ? { ownerId: desk.user_id } : {}),
  }))
}

/**
 * 既読より後に中身が変わったものを、新しい順に返す。
 *
 * 既読の記録が無いデスクは出さない。記録が無い＝保存・いいねした直後で、
 * 更新があったのかどうかを判断する材料がまだ無い。
 */
export function unreadDeskUpdates<T extends WatchedDesk>(desks: readonly T[], seen: SeenMap): T[] {
  return desks
    .filter((desk) => {
      const seenAt = seen[desk.id]
      if (!seenAt) return false
      return Date.parse(stampOf(desk)) > Date.parse(seenAt)
    })
    .sort((a, b) => Date.parse(stampOf(b)) - Date.parse(stampOf(a)))
}

/**
 * ベルに点を出すか。
 * 未読があっても、その更新より後にベル（更新一覧）を開いていれば点は出さない。
 * 個々のデスクを開くまで一覧には残るが、点は一度見たら消える
 */
export function hasUnreadBell(unread: readonly WatchedDesk[], bellSeenAt: string | null): boolean {
  if (unread.length === 0) return false
  if (!bellSeenAt) return true
  const bell = Date.parse(bellSeenAt)
  if (Number.isNaN(bell)) return true
  return unread.some((desk) => Date.parse(stampOf(desk)) > bell)
}

/**
 * 更新一覧の節分け。新しく公開されたデスクと、前から知っているデスクの変化は
 * 期待するものが違う（前者は出会い、後者は変化）。同じ一覧にラベル違いで混ぜていた頃は、
 * どちらを見に来たのかで目当ての行が埋もれた。
 *
 * 新しく公開を先に置く。件数が少なく、見逃すと次に出てこないため
 */
export function splitDeskUpdates<T extends { isNew: boolean }>(entries: readonly T[]): { fresh: T[]; changed: T[] } {
  return {
    fresh: entries.filter((entry) => entry.isNew),
    changed: entries.filter((entry) => !entry.isNew),
  }
}
