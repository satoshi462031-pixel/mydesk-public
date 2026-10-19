import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { useAuth } from '../context/AuthContext'
import { AIUsageInfo } from '../services/ai/openai'
import { supabase } from '../supabase/client'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

// サーバーが枠を返せない場合のフォールバックにだけ使う。
// 正本はサーバー側の ai_weekly_token_limit()（supabase/migrations/120_ai_token_only_limit.sql）で、
// get_ai_usage() と ai-coach の応答が token_limit を返すため、取得できたあとはそちらを使う。
// 回数ではなくトークンで数えるのは、1回の重さ（デスク情報の量・会話の長さ・写真）が回によって大きく違うから。
// Free が 0 なのは AIコーチが Pro 限定のため（枠を使い切った状態ではない）。
export const PRO_WEEKLY_TOKEN_LIMIT = 150_000
// この割合を超えたら「残りわずか」と出す
export const AI_USAGE_WARNING_RATIO = 0.8

/**
 * 利用枠がリセットされる日時。
 *
 * サーバーの期間キーは to_char(now(), 'IYYY-"W"IW')。now() は timestamptz なので
 * 週の境界は Postgres のセッションタイムゾーン（Supabase は UTC）の月曜0時であって、
 * 端末のローカル月曜0時ではない。ローカルで計算すると JST では9時間ずれ、
 * 月曜の 0:00〜9:00 に「今日リセット」と出ているのに送信が弾かれる
 * （日本時間の月曜未明はサーバーではまだ前の週）。
 */
function nextWeeklyResetDate(): Date {
  const now = new Date()
  const daysUntilMonday = ((8 - now.getUTCDay()) % 7) || 7
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
  ))
}

// 境界が端末の深夜0時とは限らない（JST なら月曜9時）ので時刻まで出す。
// 日付だけだと「その日になったのにまだ使えない」と読めてしまう
export function formatResetDate(date: Date, lang: 'ja' | 'en'): string {
  const minutes = date.getMinutes()
  const time = `${date.getHours()}:${String(minutes).padStart(2, '0')}`
  return lang === 'en'
    ? `${date.getMonth() + 1}/${date.getDate()} ${time}`
    : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

/**
 * AI利用量（週のトークン枠）の管理。
 *
 * 正本は Supabase 側（ai_usage.token_count と reserve_ai_tokens / settle_ai_tokens）にあり、
 * 予約・精算は ai-coach Edge Function の中でサーバーが行う。ここで持つ値はその
 * 「表示・事前チェック用のキャッシュ」で、
 * - マウント時に get_ai_usage() で最新値を取得
 * - Edge Function 呼び出しが成功/上限超過で返した usage で都度同期
 * する。アカウントに紐づくため、ログアウト→再ログインしても使った量は戻らない。
 *
 * 画面には回数を出さず、使った割合（usedRatio）とリセット日時だけを出す。
 * 何回送れるかは相談の長さや写真で変わるので、回数に直すと外れる。
 */
export function useAIUsageLimit() {
  const { user, profile } = useAuth()
  // AI枠はサーバーの profiles.tier と同じ判定を使い、課金UIの一時的な
  // 全機能開放設定に左右されないようにする。
  // get_ai_usage() を引けるまでの暫定値で、取得後はサーバーの is_pro で上書きする。
  const userId = user?.id
  const fallbackIsPro = profile?.id === userId && profile?.tier === 'pro'
  const usageKey = userId ? `${userId}:${fallbackIsPro ? 'pro' : 'free'}` : null
  const currentUsageKeyRef = useRef(usageKey)
  currentUsageKeyRef.current = usageKey
  const [tokenUsed, setTokenUsed] = useState(0)
  const [loaded,    setLoaded]    = useState(false)
  const [loadedKey, setLoadedKey] = useState<string | null | undefined>(undefined)
  // サーバーが返した枠と Pro 判定。null = まだ取得できていない。
  // 定数から再計算すると、サーバーの枠を変えたときにクライアントだけ古い値を
  // 表示し続ける（「残りわずか」と出ているのに送れる／その逆）ため、取れたら必ずこちらを使う
  const [serverTokenLimit, setServerTokenLimit] = useState<number | null>(null)
  const [serverIsPro,      setServerIsPro]      = useState<boolean | null>(null)

  // このフックは呼び出す画面ごとに別の state を持つ。チャット画面で applyUsage()
  // が更新しても一覧画面の値は古いままなので、画面復帰時にこれを呼んで取り直す。
  // 連続で呼ばれたとき古い応答が新しい値を上書きしないよう、最後の呼び出しだけ反映する。
  const requestIdRef = useRef(0)
  const refresh = useCallback(async () => {
    if (currentUsageKeyRef.current !== usageKey) return
    const requestId = ++requestIdRef.current
    if (!userId) {
      setTokenUsed(0)
      setServerTokenLimit(null); setServerIsPro(null)
      setLoaded(true)
      setLoadedKey(usageKey)
      return
    }
    try {
      const { data, error } = await withTimeout(Promise.resolve(supabase.rpc('get_ai_usage')), QUICK_TIMEOUT_MS)
      if (requestId !== requestIdRef.current || currentUsageKeyRef.current !== usageKey) return
      if (!error && data && data[0]) {
        const row = data[0]
        // BIGINT は PostgREST から数値か文字列で届く
        const used = row.token_count == null ? NaN : Number(row.token_count)
        const limit = row.token_limit == null ? NaN : Number(row.token_limit)
        if (Number.isFinite(used) && used >= 0) setTokenUsed(used)
        if (Number.isFinite(limit) && limit >= 0) setServerTokenLimit(limit)
        if (typeof row.is_pro === 'boolean') setServerIsPro(row.is_pro)
      }
    } catch {
      // 通信できなくても待機を解く。送信時の上限はサーバーが改めて確認する。
    } finally {
      if (requestId === requestIdRef.current && currentUsageKeyRef.current === usageKey) {
        setLoaded(true)
        setLoadedKey(usageKey)
      }
    }
  }, [userId, usageKey])

  useEffect(() => {
    setLoaded(false)
    setTokenUsed(0)
    setServerTokenLimit(null); setServerIsPro(null)
    void refresh()
    return () => { requestIdRef.current += 1 }
  }, [refresh])

  useEffect(() => {
    let resetAt = nextWeeklyResetDate().getTime()
    let timer: ReturnType<typeof setTimeout>
    const checkReset = () => {
      if (Date.now() >= resetAt) {
        setLoaded(false)
        void refresh()
      }
      resetAt = nextWeeklyResetDate().getTime()
      clearTimeout(timer)
      timer = setTimeout(checkReset, resetAt - Date.now())
    }
    checkReset()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkReset()
    })
    return () => {
      clearTimeout(timer)
      subscription.remove()
    }
  }, [refresh])

  // Edge Function のレスポンス（精算後の今週の利用量）でキャッシュを同期する
  const applyUsage = useCallback((usage: AIUsageInfo | null) => {
    if (!usage || !userId || currentUsageKeyRef.current !== usageKey) return
    requestIdRef.current += 1
    if (usage.tokenCount != null) setTokenUsed(usage.tokenCount)
    if (usage.tokenLimit != null) setServerTokenLimit(usage.tokenLimit)
    setServerIsPro(usage.isPro)
    setLoaded(true)
    setLoadedKey(usageKey)
  }, [userId, usageKey])

  const usageIsCurrent = loadedKey === usageKey
  const isPro = (usageIsCurrent ? serverIsPro : null) ?? fallbackIsPro
  const tokenLimit = (usageIsCurrent ? serverTokenLimit : null) ?? (isPro ? PRO_WEEKLY_TOKEN_LIMIT : 0)
  const used = usageIsCurrent ? tokenUsed : 0
  const usedRatio = tokenLimit > 0 ? Math.min(1, Math.max(0, used / tokenLimit)) : 1

  // 実際の予約と判定はサーバー（Edge Function 内の reserve_ai_tokens）が行う。
  // ここでは直近取得済みのキャッシュ値から見て明らかに枠が無いかだけを事前判定する
  // （送信ボタンを押す前にダイアログを出すためのUX用。最終判定はサーバー任せ）。
  // 写真も同じ枠から引く（写真のぶん多く減るだけで、別の枠は無い）
  const canUse = tokenLimit > 0 && used < tokenLimit

  return {
    canUse,
    canUsePhoto:  canUse,
    tokenCount:   used,
    tokenLimit,
    usedRatio,
    nearLimit:    canUse && usedRatio >= AI_USAGE_WARNING_RATIO,
    resetDate:    nextWeeklyResetDate(),
    consume:      async (): Promise<boolean> => canUse,
    consumePhoto: async (): Promise<boolean> => canUse,
    applyUsage,
    refresh,
    loaded: loaded && usageIsCurrent,
    isPro,
  }
}
