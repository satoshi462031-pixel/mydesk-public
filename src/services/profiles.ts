import { supabase } from '../supabase/client'
import { authenticatedSettingsSession } from './auth'
import { Profile } from '../supabase/types'

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}


/**
 * 公開プロフィール（/u/<tag>）に自分の公開デスクをまとめて出すかを切り替える。
 *
 * profiles と公開済み desks の非正規化コピーを一度に更新する必要があるため、
 * 057 の SECURITY DEFINER 関数へ委ねる（クライアントから desks を直接叩かせない）。
 */
/**
 * 公開アイコンを設定する（null で文字アイコンへ戻す）。
 *
 * 保存先は `avatar_url` ではなく `public_avatar_url`。前者は Google などで登録した
 * ときにサインインの情報から自動で入るので、本人が選んでいない写真が公開されてしまう。
 * URL が自分のフォルダにあるものかは 059 の RPC がサーバー側でも見る。
 */
export async function setPublicAvatarUrl(url: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_public_avatar_url', { p_url: url })
  if (error) throw error
  return (data as string | null) ?? null
}

/**
 * 公開タグ（@ID）を変更する。
 *
 * 形式・予約語・重複の判定はサーバー（060 の set_public_tag）が正本。
 * profiles を本人が直接 UPDATE できてしまう（046）ので、判定と公開済みデスクへの
 * 追随をまとめて RPC に置き、クライアントからは列を触らせない。
 * 失敗は PUBLIC_TAG_* の合図で返る（utils/publicTag の publicTagIssueFromError）。
 */
export async function setPublicTag(tag: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_public_tag', { p_tag: tag })
  if (error) throw error
  return data as string
}

/**
 * @ID が空いているか（063）。入力中の確認に使う。
 *
 * 形式・予約語・重複のいずれかで FALSE。保存の可否を決めるのは set_public_tag 側で、
 * ここはあくまで先出しの目安（照会と保存の間に他人が取ることはある）。
 */
export async function isPublicTagAvailable(tag: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('public_tag_available', { p_tag: tag })
  if (error) throw error
  return data === true
}

/**
 * 候補のうち空いているものを、並び順のまま先頭から limit 件返す（@ID が重なったときの代案）。
 * 照会できなかった候補は出さない。出した代案を押したら使われていた、のほうが困る。
 */
export async function findAvailablePublicTags(candidates: string[], limit = 3): Promise<string[]> {
  const results = await Promise.all(candidates.map((tag) => isPublicTagAvailable(tag).catch(() => false)))
  return candidates.filter((_, i) => results[i]).slice(0, limit)
}

export async function setProfileDiscoverable(value: boolean, expectedUserId: string): Promise<boolean> {
  const session = await authenticatedSettingsSession(expectedUserId)
  const { data, error } = await supabase.rpc('set_profile_discoverable', { p_value: value })
    .setHeader('Authorization', `Bearer ${session.access_token}`)
  if (error) throw error
  if (typeof data !== 'boolean' || data !== value) throw new Error('PROFILE_SETTING_UNCONFIRMED')
  return data
}
