// 1人の投稿者をフォローしているか（084）と、その切り替え。
// フォロー中なら、その人の通知を受け取るか（096）も同じ問い合わせで引いて切り替えられる。
//
// 押した瞬間に反映して、失敗したら戻す（ブランドの★・いいねと同じ扱い）。
// 往復を待たせると「押したのに何も起きない」時間ができる。
// 連打しても押すたびに反転し、通信は最後の状態だけを送る（utils/intentSync）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntentSync } from './useIntentSync'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { hapticSelection } from '../utils/haptics'
import { analytics, EVENTS } from '../services/analytics'
import { followUser, getFollowState, setFollowNotify, unfollowUser } from '../services/userFollows'
import { registerPushToken } from '../services/pushNotifications'
import { promptLogin } from '../utils/promptLogin'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

export type UserFollowPlacement = 'public_profile' | 'public_desk' | 'following_list'

export function useUserFollow(
  followeeId: string | null,
  // promptLogin と同じ理由で any（Login はルートにあり、どの子スタックの型にも無い）
  navigation: any,
  placement: UserFollowPlacement,
): { following: boolean; toggle: () => void; notify: boolean; toggleNotify: () => void } {
  const { user } = useAuth()
  const { lang } = useApp()
  const [following, setFollowing] = useState(false)
  // 引けていない間の false は「フォローしていない」ではなく「分からない」。
  // そのまま押すと、フォロー済みの人に insert を投げて何も変わらない
  const knownRef = useRef(false)
  const pairKey = user && followeeId ? user.id + ':' + followeeId : null
  const currentPairRef = useRef(pairKey)
  currentPairRef.current = pairKey
  const readGenerationRef = useRef(0)
  const readInFlightRef = useRef<Promise<boolean> | null>(null)
  // 連打の2回目は再描画より先に届きうる。押した時点の状態は描画を待たずにここから読む
  const followingRef = useRef(false)
  const [notify, setNotify] = useState(true)
  const notifyRef = useRef(true)
  const applyNotify = useCallback((value: boolean) => {
    notifyRef.current = value
    setNotify(value)
  }, [])
  const apply = useCallback((value: boolean) => {
    followingRef.current = value
    setFollowing(value)
    // フォローし直すと行が作り直され、通知は既定のオンに戻る（096）
    if (value) applyNotify(true)
  }, [applyNotify])
  const notifySync = useIntentSync<string>({
    send: async (id, value) => {
      if (!user) throw new Error('signed out')
      await setFollowNotify(user.id, id, value)
    },
    onFailed: (_, value) => applyNotify(value),
  })
  const sync = useIntentSync<string>({
    send: async (id, value) => {
      if (!user) throw new Error('signed out')
      if (value) await followUser(user.id, id)
      else await unfollowUser(user.id, id)
    },
    onConfirmed: (_, value) => {
      analytics.track(EVENTS.USER_FOLLOW_TOGGLED, { followed: value, placement })
      // 通知の許可を聞くのはここだけ。フォローした直後なら「この人の更新が届く」と分かって選べる
      if (value) void registerPushToken(lang, { prompt: true })
    },
    onFailed: (_, value) => apply(value),
  })

  const userId = user?.id
  const readState = useCallback((): Promise<boolean> => {
    if (!userId || !followeeId || userId === followeeId || currentPairRef.current !== pairKey) return Promise.resolve(false)
    if (readInFlightRef.current) return readInFlightRef.current
    const generation = readGenerationRef.current
    const work = withTimeout(getFollowState(userId, followeeId), QUICK_TIMEOUT_MS)
      .then(state => {
        if (readGenerationRef.current !== generation || currentPairRef.current !== pairKey) return false
        if (sync.isBusy(followeeId)) return knownRef.current
        knownRef.current = true
        apply(state.following)
        if (!notifySync.isBusy(followeeId)) applyNotify(state.notify)
        return true
      })
      .catch(() => false)
      .finally(() => { if (readInFlightRef.current === work) readInFlightRef.current = null })
    readInFlightRef.current = work
    return work
  }, [userId, followeeId, pairKey, apply, applyNotify, sync, notifySync])

  useEffect(() => {
    knownRef.current = false
    apply(false)
    void readState()
    return () => {
      readGenerationRef.current += 1
      readInFlightRef.current = null
    }
  }, [readState, apply])

  const toggle = useCallback(async () => {
    if (!user) {
      promptLogin(navigation, lang, lang === 'ja'
        ? 'フォローするにはログインしてください'
        : 'Please log in to follow people.')
      return
    }
    if (!followeeId || user.id === followeeId || currentPairRef.current !== pairKey) return
    // 初回取得の失敗を固定しない。次のタップで本人の状態を取り直してから反転する。
    if (!knownRef.current && !await readState()) return
    if (currentPairRef.current !== pairKey) return
    const was = followingRef.current
    hapticSelection()
    apply(!was)
    sync.request(followeeId, was, !was)
  }, [user, followeeId, pairKey, navigation, lang, apply, sync, readState])

  // フォロー中の相手にだけ意味がある（行が無いと書き換えるものが無い）。
  // フォローの送信中に押すと、行ができる前の update が空振りするので待たせる
  const toggleNotify = useCallback(() => {
    if (!user || !followeeId || currentPairRef.current !== pairKey || !followingRef.current || sync.isBusy(followeeId)) return
    const was = notifyRef.current
    hapticSelection()
    applyNotify(!was)
    notifySync.request(followeeId, was, !was)
  }, [user, followeeId, pairKey, applyNotify, sync, notifySync])

  return { following, toggle, notify, toggleNotify }
}
