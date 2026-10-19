// ─── 投稿者のフォロー（084）────────────────────────────────────
//
// 行が持つのは相手の user_id だけ。名前・タグ・アイコンは相手の公開デスクに
// 非正規化してある owner_* から読むたびに引く（profiles は 046 から本人しか読めない）。
// 絞り込みは公開プロフィールと同じ「公開中・プロフィール公開」。相手が
// プロフィールを非公開にしたら、人単位の集約であるフォローからも見えなくする（057）。
import { supabase } from '../supabase/client'
import { UNIQUE_VIOLATION } from '../supabase/postgresErrors'
import { DeskWithDetails } from '../supabase/types'
import type { WatchedDeskStamp } from './desks'

const TABLE = 'user_follows'

/** 更新一覧に載せる件数の上限。share_snapshot ごと引くので全件は取らない */
const FOLLOWED_DESK_LIMIT = 50

export async function listFollowedUserIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('followee_id')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row: { followee_id: string }) => row.followee_id)
}

/** フォローしているかと、その人の通知を受け取るか（096）。フォローしていなければ notify は既定の true */
export async function getFollowState(userId: string, followeeId: string): Promise<{ following: boolean; notify: boolean }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('notify')
    .eq('follower_id', userId)
    .eq('followee_id', followeeId)
    .maybeSingle()
  if (error) throw error
  return { following: !!data, notify: data?.notify !== false }
}

export async function followUser(userId: string, followeeId: string): Promise<void> {
  if (userId === followeeId) return
  const { error } = await supabase.from(TABLE).insert({ follower_id: userId, followee_id: followeeId })
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}

export async function unfollowUser(userId: string, followeeId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('follower_id', userId)
    .eq('followee_id', followeeId)
  if (error) throw error
}

/** この人の公開・更新を通知で受け取るか（096）。フォローしていない相手には何もしない */
export async function setFollowNotify(userId: string, followeeId: string, notify: boolean): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ notify })
    .eq('follower_id', userId)
    .eq('followee_id', followeeId)
  if (error) throw error
}

export interface FollowedProfile {
  userId: string
  /** この人の公開・更新を通知で受け取るか（096）。フォローとは別に切れる */
  notify: boolean
  /** 公開デスクから引けなかった相手は null（公開をやめた・プロフィールを非公開にした） */
  name: string | null
  tag: string | null
  avatarUrl: string | null
}

/**
 * フォロー中の一覧に出す相手の名乗り。フォローした順（新しい順）で返す。
 * 名乗りは各人のいちばん新しい公開デスクのもの（publishService が公開のたびに写す）。
 */
export async function listFollowedProfiles(userId: string): Promise<FollowedProfile[]> {
  const { data: follows, error: followError } = await supabase
    .from(TABLE)
    .select('followee_id, notify')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false })
  if (followError) throw followError
  const followRows = (follows ?? []) as Array<{ followee_id: string; notify: boolean | null }>
  const ids = followRows.map((row) => row.followee_id)
  const notifyById = new Map(followRows.map((row) => [row.followee_id, row.notify !== false]))
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('desks')
    .select('user_id, owner_name, owner_tag, owner_avatar_url, updated_at')
    .in('user_id', ids)
    .eq('visibility', 'public')
    .eq('owner_profile_public', true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  const latest = new Map<string, { owner_name: string; owner_tag: string; owner_avatar_url: string | null }>()
  for (const row of (data ?? []) as Array<{ user_id: string; owner_name: string; owner_tag: string; owner_avatar_url: string | null }>) {
    if (!latest.has(row.user_id)) latest.set(row.user_id, row)
  }
  return ids.map((id) => {
    const row = latest.get(id)
    return {
      userId: id,
      notify: notifyById.get(id) ?? true,
      name: row?.owner_name || null,
      tag: row?.owner_tag || null,
      avatarUrl: row?.owner_avatar_url ?? null,
    }
  })
}

/** フォロー中の人の公開デスク（更新一覧の中身）。share_snapshot ごと引く */
export async function listFollowedDesks(followeeIds: readonly string[]): Promise<DeskWithDetails[]> {
  if (followeeIds.length === 0) return []
  const { data, error } = await supabase
    .from('desks')
    .select('*, desk_photos ( id, image_url, sort_order )')
    .in('user_id', followeeIds)
    .eq('visibility', 'public')
    .eq('owner_profile_public', true)
    .order('updated_at', { ascending: false })
    .limit(FOLLOWED_DESK_LIMIT)
  if (error) throw error
  return (data ?? []) as DeskWithDetails[]
}

/** ベルの点用。listFollowedDesks と同じ範囲を更新時刻だけで引く */
export async function listFollowedDeskStamps(followeeIds: readonly string[]): Promise<WatchedDeskStamp[]> {
  if (followeeIds.length === 0) return []
  const { data, error } = await supabase
    .from('desks')
    .select('id, user_id, updated_at, content_updated_at, visibility')
    .in('user_id', followeeIds)
    .eq('visibility', 'public')
    .eq('owner_profile_public', true)
    .order('updated_at', { ascending: false })
    .limit(FOLLOWED_DESK_LIMIT)
  if (error) throw error
  return (data ?? []) as WatchedDeskStamp[]
}
