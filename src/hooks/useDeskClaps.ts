import { useCallback, useEffect, useRef, useState } from 'react'
import { analytics, EVENTS } from '../services/analytics'
import { getDeskLikeCounts, getLikedDeskIds, setDeskLiked } from '../services/desks'
import { hapticMedium } from '../utils/haptics'
import { useIntentSync } from './useIntentSync'

type ClapTarget = { deskId: string; userId: string }

/**
 * マイページの履歴・保存のタイルで拍手を押せるようにする（みんなのデスクのタイルと同じ操作）。
 * 2つの一覧は同じ見た目に揃えているので、件数の読み込みと送信もここで1つにする。
 * likedIds は「今の版に拍手したデスク」。前の版にだけ拍手したデスクは押せる状態に戻る。
 *
 * みんなのデスク（DeskFeedScreen）と同じ3つの守りを持つ。後から足したこちらに無く、件数がずれていた：
 * ・一覧を読み直すたびに拍手も読み直す（公開デスクで拍手して戻っても古いままだった）
 * ・拍手済みか分からないデスクは、押された時点で先に引く（分からないまま反転すると、
 *   拍手済みのデスクに重ねて送り、サーバーは変わらないのに件数だけ +1 されていた）
 * ・押したあとに届いた読み込みでは、そのデスクを押す前の値へ戻さない
 */
export function useDeskClaps(deskIds: string[], userId: string | undefined, placement: string, onSignedOut: () => void) {
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  // 押した時点の状態は描画を待たずにここから読む（拍手済みかを引く await の後でも最新を見る）
  const likedIdsRef = useRef(likedIds)
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map())
  // 拍手済みかを引けたデスク。引けていないデスクの「未拍手」は「分からない」の意味
  const knownRef = useRef(new Set<string>())
  const checkingRef = useRef(new Map<string, Promise<boolean>>())
  const currentUserRef = useRef(userId)
  currentUserRef.current = userId
  const targetsRef = useRef(new Map<string, ClapTarget>())
  const targetFor = useCallback((deskId: string, owner: string): ClapTarget => {
    const existing = targetsRef.current.get(deskId)
    if (existing?.userId === owner) return existing
    const target = { deskId, userId: owner }
    targetsRef.current.set(deskId, target)
    return target
  }, [])
  // デスクごとに押した回数。読み込みを始めた時点と比べ、その後に押されたデスクは上書きしない
  const tapSeqRef = useRef(new Map<string, number>())
  const tapSeq = useCallback((deskId: string) => tapSeqRef.current.get(deskId) ?? 0, [])

  const updateLiked = useCallback((change: (prev: Set<string>) => Set<string>) => {
    likedIdsRef.current = change(likedIdsRef.current)
    setLikedIds(likedIdsRef.current)
  }, [])

  const applyLiked = useCallback((deskId: string, liked: boolean) => {
    if (likedIdsRef.current.has(deskId) === liked) return
    updateLiked((prev) => {
      const next = new Set(prev)
      if (liked) next.add(deskId)
      else next.delete(deskId)
      return next
    })
    setLikeCounts((prev) => {
      const count = prev.get(deskId)
      return count === undefined ? prev : new Map(prev).set(deskId, Math.max(0, count + (liked ? 1 : -1)))
    })
  }, [updateLiked])

  const likeSync = useIntentSync<ClapTarget>({
    send: async (target, liked) => {
      if (currentUserRef.current !== target.userId) throw new Error('signed out')
      await setDeskLiked(target.deskId, target.userId, liked)
    },
    onConfirmed: (target, liked) => {
      if (currentUserRef.current !== target.userId) return
      analytics.track(EVENTS.LIKE_TOGGLED, { liked, placement })
    },
    onSettled: (target) => {
      if (currentUserRef.current !== target.userId) return
      reconcileCount(target.deskId)
    },
    onFailed: (target, liked) => {
      if (currentUserRef.current !== target.userId) return
      applyLiked(target.deskId, liked)
      reconcileCount(target.deskId)
    },
  })
  const isSending = useCallback((deskId: string) => !!userId && likeSync.isBusy(targetFor(deskId, userId)), [likeSync, targetFor, userId])

  useEffect(() => {
    knownRef.current = new Set()
    checkingRef.current.clear()
    targetsRef.current.clear()
    updateLiked(() => new Set())
  }, [userId, updateLiked])

  // 依存は ID の並びではなく配列そのもの。一覧は画面に戻るたびに読み直して新しい配列になるので、
  // 並びが同じでもそこで拍手を引き直す（並びで比べていた頃は、詳細で拍手して戻っても変わらなかった）
  useEffect(() => {
    const ids = deskIds
    if (ids.length === 0) return
    let alive = true
    const startSeq = new Map(ids.map((id) => [id, tapSeq(id)]))
    const untouched = (id: string) =>
      !isSending(id) && !checkingRef.current.has(id) && tapSeq(id) === startSeq.get(id)
    getDeskLikeCounts(ids)
      .then((counts) => {
        if (!alive) return
        setLikeCounts((prev) => {
          const next = new Map(prev)
          for (const id of ids) if (untouched(id)) next.set(id, counts.get(id) ?? 0)
          return next
        })
      })
      .catch(() => {})
    if (userId) {
      getLikedDeskIds(userId, ids)
        .then(({ current }) => {
          if (!alive) return
          const fresh = ids.filter(untouched)
          fresh.forEach((id) => knownRef.current.add(id))
          updateLiked((prev) => {
            const next = new Set(prev)
            for (const id of fresh) {
              if (current.has(id)) next.add(id)
              else next.delete(id)
            }
            return next
          })
        })
        // 引けなかったデスクは known に入れない。押されたときに引き直す
        .catch(() => {})
    } else {
      updateLiked(() => new Set())
    }
    return () => { alive = false }
  }, [deskIds, userId, updateLiked, tapSeq, isSending])

  // 手元の ±1 は見込みで、正はサーバーの件数。送り終えたら合わせ直す。
  // 重ねて送った拍手（一意制約で弾かれる）や、版が変わった直後の取り消し（消える行が無い）は
  // 成功で返るのにサーバーの件数が動かず、合わせ直さないと ±1 ずれたまま残る
  const reconcileCount = useCallback((deskId: string) => {
    const seq = tapSeq(deskId)
    getDeskLikeCounts([deskId])
      .then((counts) => {
        if (currentUserRef.current !== userId || isSending(deskId) || tapSeq(deskId) !== seq) return
        setLikeCounts((prev) => new Map(prev).set(deskId, counts.get(deskId) ?? 0))
      })
      .catch(() => {})
  }, [tapSeq, isSending, userId])

  const readClap = useCallback((deskId: string): Promise<boolean> => {
    const pending = checkingRef.current.get(deskId)
    if (pending) return pending
    if (!userId || currentUserRef.current !== userId) return Promise.resolve(false)
    const work = getLikedDeskIds(userId, [deskId]).then(({ current }) => {
      if (currentUserRef.current !== userId) return false
      knownRef.current.add(deskId)
      updateLiked((prev) => {
        const next = new Set(prev)
        if (current.has(deskId)) next.add(deskId)
        else next.delete(deskId)
        return next
      })
      return true
    }).catch(() => false).finally(() => {
      if (checkingRef.current.get(deskId) === work) checkingRef.current.delete(deskId)
    })
    checkingRef.current.set(deskId, work)
    return work
  }, [userId, updateLiked])

  const toggleClap = useCallback(async (deskId: string, onClap: () => void) => {
    if (!userId) {
      onSignedOut()
      return
    }
    if (currentUserRef.current !== userId) return
    if (!knownRef.current.has(deskId) && !await readClap(deskId)) return
    if (currentUserRef.current !== userId) return
    const wasLiked = likedIdsRef.current.has(deskId)
    tapSeqRef.current.set(deskId, tapSeq(deskId) + 1)
    hapticMedium()
    applyLiked(deskId, !wasLiked)
    if (!wasLiked) onClap()
    likeSync.request(targetFor(deskId, userId), wasLiked, !wasLiked)
  }, [userId, onSignedOut, applyLiked, likeSync, targetFor, readClap, tapSeq])

  return { likedIds, likeCounts, toggleClap }
}

export function clapButtonLabel(liked: boolean, likeCount: number | undefined, ja: boolean): string {
  const action = liked ? (ja ? '拍手を取り消す' : 'Remove applause') : (ja ? '拍手する' : 'Applaud')
  if (likeCount === undefined) return action
  return ja ? `${action}（${likeCount}件）` : `${action} (${likeCount})`
}
