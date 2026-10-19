import { Platform } from 'react-native'
import * as Updates from 'expo-updates'
import appConfig from '../../app.json'
import { supabase } from '../supabase/client'
import { analytics, EVENTS, errorProperties } from './analytics'
import { lastCrashEventId } from './crashReporting'
import { snapshotTrail } from '../utils/diagnosticTrail'
import { truncateChars } from '../utils/truncateText'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

// アプリ内フィードバック。メールアプリに飛ばすと送信率が落ちるうえ、
// メール未設定の端末では行き止まりになるため、アプリ内で完結させる。
// 保存先は supabase/migrations/031_feedback.sql の feedback テーブル。

export type FeedbackCategory = 'bug' | 'request' | 'other'

export const FEEDBACK_MAX_LENGTH = 2000
const FEEDBACK_TIMEOUT_MS = 20_000

export interface FeedbackInput {
  expectedUserId?: string
  category: FeedbackCategory
  body: string
  // 送信フォームで本人が選ぶ。直前の操作は利用状況データにあたり、
  // 解析をオフにしている人からも黙って集めることはしない
  attachTrail: boolean
  environment: { lang: 'ja' | 'en'; theme: 'light' | 'dark'; plan: string }
}

// 返信の手段が無く聞き返せないので、再現に要る環境は送信の時点で揃える。
// 版番号だけでは足りない：runtimeVersion が appVersion 方式なので、修正は同じ版番号の
// OTA 更新でも届く。どの JS バンドルで起きたかを createdAt で持ち、修正の前後を判定する
function buildContext({ attachTrail, environment }: FeedbackInput): Record<string, unknown> {
  const bundle = Updates.isEnabled
    ? {
        id: Updates.updateId,
        createdAt: Updates.createdAt?.toISOString() ?? null,
        embedded: Updates.isEmbeddedLaunch,
        channel: Updates.channel,
      }
    : null
  const crashEventId = attachTrail ? lastCrashEventId() : undefined
  return {
    os: String(Platform.Version),
    ...(Platform.OS === 'ios' && Platform.isPad ? { pad: true } : {}),
    ...environment,
    bundle,
    ...(attachTrail ? { trail: snapshotTrail() } : {}),
    ...(crashEventId ? { crashEventId } : {}),
  }
}

/**
 * フィードバックを送信する。039_security_privacy_hardening.sql 以降は
 * 匿名でのDB直書きを許可していないため、ログイン済みセッションが必要。
 */
export async function submitFeedback(input: FeedbackInput): Promise<void> {
  const { category, body } = input
  if (!['bug', 'request', 'other'].includes(category)) throw new Error('INVALID_CATEGORY')
  const text = body.trim()
  if (!text) throw new Error('EMPTY_BODY')

  try {
    // getSession も期限切れトークンの更新を待つことがあるため、待機に期限を設ける。
    const { data: { session }, error: sessionError } = await withTimeout(supabase.auth.getSession(), QUICK_TIMEOUT_MS)
    if (sessionError) throw sessionError
    if (!session) throw new Error('AUTH_REQUIRED')
    if (input.expectedUserId && session.user.id !== input.expectedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FEEDBACK_TIMEOUT_MS)
    try {
      const { error } = await supabase
        .from('feedback')
        .insert({
          user_id: session.user.id,
          category,
          body: truncateChars(text, FEEDBACK_MAX_LENGTH),
          app_version: appConfig.expo?.version ?? 'unknown',
          platform: Platform.OS,
          context: buildContext(input),
        })
        .abortSignal(controller.signal)
      if (error) throw error.message === 'REPORT_RATE_LIMITED' ? new Error('REPORT_RATE_LIMITED') : error
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    // 本文は利用者の入力なので送らない。失敗したこととカテゴリだけ記録する
    analytics.track(EVENTS.FEEDBACK_FAILED, { category, ...errorProperties(error) })
    throw error
  }

  analytics.track(EVENTS.FEEDBACK_SUBMITTED, { category, body_length: text.length, trail_attached: input.attachTrail })
}
