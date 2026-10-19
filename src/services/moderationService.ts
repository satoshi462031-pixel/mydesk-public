// 公開デスクの通報とユーザーブロック（App Store ガイドライン 1.2 対応）。
// テーブル定義とRLSは supabase/migrations/030_ugc_moderation.sql を参照。
import { supabase } from '../supabase/client'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { truncateChars } from '../utils/truncateText'
import { isUuid } from '../utils/shortDeskId'

export type ReportReason = 'inappropriate' | 'spam' | 'infringement' | 'other'

export interface BlockedUser {
  blocked_id: string
  blocked_name: string | null
  created_at: string
}

/**
 * 公開デスクを通報する。
 * 同じデスクへの2回目以降は UNIQUE 制約で弾かれるが、利用者から見れば
 * 「通報済み」で目的は達しているため、重複はエラーにしない。
 */
export async function reportDesk(deskId: string, reason: ReportReason, note?: string): Promise<void> {
  if (!isUuid(deskId) || !['inappropriate', 'spam', 'infringement', 'other'].includes(reason)) throw new Error('INVALID_REPORT')
  const { data: { user }, error: authError } = await withTimeout(supabase.auth.getUser(), QUICK_TIMEOUT_MS)
  if (authError) throw authError
  if (!user) throw new Error('ログインが必要です')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), QUICK_TIMEOUT_MS)
  try {
    const { error } = await withTimeout(Promise.resolve(supabase
      .from('desk_reports')
      .insert({ desk_id: deskId, reporter_id: user.id, reason, note: truncateChars(note?.trim() ?? '', 1000) || null })
      .abortSignal(controller.signal)), QUICK_TIMEOUT_MS)
    if (error && error.code !== '23505') throw error.message === 'REPORT_RATE_LIMITED' ? new Error('REPORT_RATE_LIMITED') : error
  } finally {
    clearTimeout(timeout)
  }
}

export async function blockUser(blockedId: string, blockedName?: string | null): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ログインが必要です')
  if (user.id === blockedId) throw new Error('自分自身はブロックできません')

  const { error } = await supabase
    .from('blocked_users')
    .upsert(
      { blocker_id: user.id, blocked_id: blockedId, blocked_name: blockedName?.trim() || null },
      { onConflict: 'blocker_id,blocked_id' },
    )
  if (error) throw error
}

export async function unblockUser(blockedId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ログインが必要です')

  const { error } = await supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', user.id)
    .eq('blocked_id', blockedId)
  if (error) throw error
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocked_id, blocked_name, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as BlockedUser[]
}

/**
 * 一覧のフィルタ用。RLS により自分がブロックした相手だけが返る。
 *
 * **失敗を空の Set で代用しないこと。** ここはキャッシュを持たないので、
 * 読めなかったぶんはそのまま「誰もブロックしていない」になり、
 * ブロックした相手のデスクが一覧・検索・通知に出る。呼び出し側は例外を
 * そのまま一覧の読み込み失敗として扱い、絞り込めていない一覧を出さない。
 */
export async function getBlockedUserIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('blocked_users').select('blocked_id')
  if (error) throw error
  return new Set((data ?? []).map((row: { blocked_id: string }) => row.blocked_id))
}

export async function isUserBlocked(blockedId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('blocked_users')
    .select('blocked_id')
    .eq('blocked_id', blockedId)
    .maybeSingle()
  if (error) throw error
  return !!data
}
