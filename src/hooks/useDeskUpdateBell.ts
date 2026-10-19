// 更新（保存したデスク・フォロー中の人の公開デスク）と、自分のデスクに付いたいいね（086）に未読があるか。
//
// 数字は出さない。「3件たまっている」と言われても、見に行く動機はどうせ
// 「何か変わったらしい」までで、数だけ増えていく表示は消化しないと減らない借金になる。
// 点だけなら見た時点で消せる（YouTube と同じ）。
//
// 点はタブバーの「みんなのデスク」と、その画面のベルの2か所に出る。
// 画面の中だけに出していた頃は、そのタブを開いた人しか未読に気づけず、
// マイデスクから始める人には無いのと同じだった。
// そのため状態はモジュールで共有し、同時に2か所から呼ばれても問い合わせは1回にする。
//
// ここでは更新時刻しか引かない（listWatchedDeskStamps / listFollowedDeskStamps）。
// 何が変わったかは useDeskUpdates が share_snapshot ごと読む。
// 対象（保存＋フォロー中の人の公開デスク）は services/deskUpdates.ts と揃える。
import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../context/AuthContext'
import { listWatchedDeskStamps, WatchedDeskStamp } from '../services/desks'
import { getBlockedUserIds } from '../services/moderationService'
import { listFollowedDeskStamps, listFollowedUserIds } from '../services/userFollows'
import { getBellSeenAt, syncSeen } from '../utils/bookmarkSeen'
import { hasUnreadBell, unreadDeskUpdates, watchedSeenEntries } from '../utils/deskUpdateFeed'
import { loadReactionsSinceSeen } from '../services/deskReactions'
import { newLikeReactions } from '../utils/deskReactions'

// タブバーと画面の両方が focus のたびに呼ぶので、続けて走らせない
const MIN_INTERVAL_MS = 30_000

let hasUnread = false
let lastCheckedAt = 0
let inFlight: Promise<void> | null = null
const listeners = new Set<(value: boolean) => void>()

function publish(value: boolean): void {
  if (hasUnread === value) return
  hasUnread = value
  for (const listener of listeners) listener(value)
}

/**
 * 点を消す。更新を見せた側（更新一覧・みんなのデスクの更新セクション）が呼ぶ。
 * サーバーへの記録は bookmarkSeen.markBellSeen が持つので、ここは画面の見た目だけ
 */
export function clearDeskUpdateBell(): void {
  lastCheckedAt = Date.now()
  publish(false)
}

async function check(userId: string): Promise<void> {
  const [bookmarked, blockedIds, followeeIds] = await Promise.all([
    listWatchedDeskStamps(userId),
    getBlockedUserIds(),
    listFollowedUserIds(userId),
  ])
  const followees = followeeIds.filter((id) => !blockedIds.has(id))
  const followed = await listFollowedDeskStamps(followees)
  // ブロックした相手のデスクで点が出ると、開いても何も無い一覧に飛ぶ
  const byId = new Map<string, WatchedDeskStamp>()
  for (const desk of [...bookmarked, ...followed]) {
    if (!blockedIds.has(desk.user_id)) byId.set(desk.id, desk)
  }
  const visible = [...byId.values()]
  // 初めて見るデスクをここで既読にしておく。保存した直後のデスクが
  // 「更新された」に化けるのを防ぐのは、一覧ではなくこの同期の役目
  const seen = await syncSeen(watchedSeenEntries(visible, followees), { followees })
  if (hasUnreadBell(unreadDeskUpdates(visible, seen), await getBellSeenAt())) {
    publish(true)
    return
  }
  // 自分のデスクに付いたいいね（086）も同じベルで知らせる。取れなくても、
  // デスクの更新の判定まで巻き込んで点を消さない
  const reactions = await loadReactionsSinceSeen().catch(() => [])
  publish(newLikeReactions(reactions).length > 0)
}

export function refreshDeskUpdateBell(userId: string | undefined, force = false): void {
  if (!userId) { publish(false); return }
  if (inFlight) return
  if (!force && Date.now() - lastCheckedAt < MIN_INTERVAL_MS) return
  inFlight = check(userId)
    .catch(() => {
      // 取れなければ点を出さない。通信が悪いだけで点を灯すと、開いても空の一覧に着く
      publish(false)
    })
    .finally(() => {
      lastCheckedAt = Date.now()
      inFlight = null
    })
}

export function useDeskUpdateBell(): { hasUnread: boolean; refresh: () => void } {
  const { user } = useAuth()
  const [value, setValue] = useState(hasUnread)

  useEffect(() => {
    listeners.add(setValue)
    setValue(hasUnread)
    return () => { listeners.delete(setValue) }
  }, [])

  const refresh = useCallback(() => { refreshDeskUpdateBell(user?.id, true) }, [user?.id])

  useFocusEffect(useCallback(() => { refreshDeskUpdateBell(user?.id) }, [user?.id]))

  return { hasUnread: value, refresh }
}
