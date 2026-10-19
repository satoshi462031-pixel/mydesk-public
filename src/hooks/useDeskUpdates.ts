// 更新（保存したデスクの変化・フォロー中の人が新しく公開したデスク）の中身。
//
// 更新一覧（DeskUpdatesScreen）と、みんなのデスクの先頭に出す更新の行が同じものを見る。
// 2画面で読み込みと既読同期を別々に書くと、片方だけ既読になる・片方だけ空になる、が起きる。
//
// 点（useDeskUpdateBell）は更新時刻しか引かない軽い問い合わせ。こちらは share_snapshot まで
// 読んで「何が変わったか」を出すので、未読があるときだけ呼ぶこと（enabled）。
import { useCallback, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { analytics, EVENTS } from '../services/analytics'
import { loadWatchedDesks } from '../services/deskUpdates'
import { DeskWithDetails } from '../supabase/types'
import { deskUpdateStamp, markBellSeen, markSeen, SeenMap, syncSeen } from '../utils/bookmarkSeen'
import { DeskChange, summarizeDeskChanges } from '../utils/deskChangeSummary'
import { isNewFollowedDesk, unreadDeskUpdates, watchedSeenEntries } from '../utils/deskUpdateFeed'
import { toGadgets, toGadgetUsage } from '../utils/publicDeskAdapter'
import { clearDeskUpdateBell } from './useDeskUpdateBell'

export interface DeskUpdateEntry {
  desk: DeskWithDetails
  /** フォロー中の人が新しく公開したデスク。変化の行は持たない */
  isNew: boolean
  /** 一覧に出す時刻。変化があればその日、無ければデスクの更新時刻 */
  changedAt: string
  changes?: DeskChange[]
}

interface Options {
  userId: string | undefined
  /** 未読があるときだけ true。false の間は問い合わせない */
  enabled: boolean
  /** 読み込めたら点を消す。更新を実際に見せる側だけ true にする */
  clearBell?: boolean
  /** 計測に載せる置き場所 */
  placement: string
}

export function useDeskUpdates({ userId, enabled, clearBell = false, placement }: Options) {
  const [entries, setEntries] = useState<DeskUpdateEntry[]>([])
  const [seen, setSeen] = useState<SeenMap>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    if (!userId || !enabled) { setEntries([]); setLoading(false); return }
    setLoadError(false)
    try {
      const { desks, followees } = await loadWatchedDesks(userId)
      // 既読の記録を先に整える。初めて見るデスクはここで現在値が入るので、
      // 保存した直後のデスクが「更新された」として並ぶことはない
      const nextSeen = await syncSeen(watchedSeenEntries(desks, followees), { followees })
      const unread = unreadDeskUpdates(desks, nextSeen)
      setSeen(nextSeen)
      setEntries(unread.map((desk) => {
        // 新しく公開されたデスクには「何が変わったか」が無い。履歴の最後を変化として
        // 出すと、公開前の組み替えを今起きた更新のように見せてしまう
        const isNew = isNewFollowedDesk(nextSeen, desk.id)
        const summary = isNew ? undefined : summarizeDeskChanges(toGadgets(desk), toGadgetUsage(desk))
        return { desk, isNew, changedAt: summary?.date ?? deskUpdateStamp(desk), changes: summary?.changes }
      }))
      if (clearBell) {
        // 点を消すのは読み込めたときだけ。失敗しても消すと、
        // 通信が戻ったあとに更新へ気づく手がかりが無くなる。
        //
        // 渡すのは「いま見た中でいちばん新しいサーバー時刻」。端末の現在時刻を
        // 入れると、比べる相手（content_updated_at）がサーバー時刻なので、
        // 時計が進んでいる端末ではその差のぶん新しい更新の点が出なくなる
        const latestStamp = desks.reduce<string | null>((max, desk) => {
          const stamp = deskUpdateStamp(desk)
          return max === null || Date.parse(stamp) > Date.parse(max) ? stamp : max
        }, null)
        await markBellSeen(latestStamp ?? undefined)
        clearDeskUpdateBell()
      }
      analytics.track(EVENTS.DESK_UPDATES_VIEWED, { unread_count: unread.length, placement })
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [userId, enabled, clearBell, placement])

  // 開くたびに取り直す。点が消える瞬間と一覧の中身は必ず一致させる
  useFocusEffect(useCallback(() => { void load() }, [load]))

  // タイルは memo なので、行ごとに新しい関数を渡さない（bookmarkSeen と同じ作り）
  const entriesRef = useRef<DeskUpdateEntry[]>([])
  entriesRef.current = entries

  /** デスクを開いたら既読にする。一覧からはその行が次の読み込みで落ちる */
  const markOpened = useCallback((deskId: string) => {
    const entry = entriesRef.current.find((e) => e.desk.id === deskId)
    if (entry) void markSeen(deskId, deskUpdateStamp(entry.desk))
  }, [])

  const isNewById = useMemo(() => seen, [seen])

  return { entries, seen: isNewById, loading, loadError, reload: load, markOpened }
}
