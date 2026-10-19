import { useCallback, useEffect, useRef, useState } from 'react'
import { getDeskWithDetails } from '../services/desks'
import { DeskWithDetails } from '../supabase/types'
import { dropPrefetchedDesk, getPrefetchedDesk, putPrefetchedDesk } from '../utils/deskDetailPrefetch'

// デスク詳細 (写真・デバイス・接続込み)
// 起動時に先読みしてあるデスク（デモデスク）は、通信を待たずキャッシュを即返す。
// 内容が古い可能性はあるので、返したあとに裏で取り直して差し替える。
export function useDeskDetail(deskId: string | null) {
  const [desk, setDesk]       = useState<DeskWithDetails | null>(() => (deskId ? getPrefetchedDesk(deskId) : null))
  // 初回レンダーで false だと、取得が始まる前に「見つかりません」が一瞬表示される。
  // 先読み済みなら待つものが無いので最初から false
  const [loading, setLoading] = useState(() => !!deskId && !getPrefetchedDesk(deskId))
  const [error, setError]     = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const reload = useCallback(async (silent = false) => {
    if (!deskId) return
    const requestId = ++requestIdRef.current
    if (!silent) setLoading(true)
    try {
      const data = await getDeskWithDetails(deskId)
      if (requestId !== requestIdRef.current) return
      setDesk(data)
      if (data) putPrefetchedDesk(deskId, data)
      else dropPrefetchedDesk(deskId)
      setError(null)
    } catch (e: unknown) {
      if (requestId !== requestIdRef.current) return
      // 先読み分を表示できているなら、再取得の失敗でエラー画面に落とさない
      if (!silent) setError(e instanceof Error ? e.message : 'デスクを読み込めませんでした')
    } finally {
      if (requestId === requestIdRef.current && !silent) setLoading(false)
    }
  }, [deskId])

  useEffect(() => {
    requestIdRef.current += 1
    setError(null)
    if (deskId) {
      const prefetched = getPrefetchedDesk(deskId)
      setDesk(prefetched)
      setLoading(!prefetched)
      void reload(!!prefetched)
    } else {
      setDesk(null)
      setLoading(false)
    }
    return () => { requestIdRef.current += 1 }
  }, [deskId, reload])

  return { desk, loading, error, reload }
}
