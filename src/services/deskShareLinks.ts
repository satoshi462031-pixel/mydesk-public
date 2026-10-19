import { supabase } from '../supabase/client'
import { buildPublicUrl } from '../constants/plans'
import { isUuid } from '../utils/shortDeskId'

/** 限定公開では実デスクIDをリンクへ出さず、所有者か有効なリンクの所持者だけが共有IDを取得する。 */
export async function getDeskShareIdentifier(deskId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_desk_share_identifier', { p_desk_id: deskId })
  // DB適用前でも通常公開は共有できる。限定公開の実IDへはフォールバックしない。
  if (error?.code === 'PGRST202') {
    const legacy = await supabase.from('desks').select('id, visibility').eq('id', deskId).maybeSingle()
    if (legacy.error) throw legacy.error
    if (legacy.data?.visibility === 'public' && isUuid(legacy.data.id)) return legacy.data.id
  }
  if (error) throw error
  if (typeof data !== 'string' || !isUuid(data)) throw new Error('DESK_NOT_PUBLIC')
  return data
}

export async function getDeskShareUrl(deskId: string, ownerTag?: string | null): Promise<string> {
  return buildPublicUrl(await getDeskShareIdentifier(deskId), ownerTag)
}

/**
 * 所有者のみ。応答を失った場合は再発行せず getDeskShareUrl で現在のURLを取り直す。
 * 画面からは直接呼ばず publishService の reissueUnlistedLink を使う（写真のパスも振り直す）。
 */
export async function reissueUnlistedDeskUrl(deskId: string, ownerTag?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('reissue_unlisted_desk_link', { p_desk_id: deskId })
  if (error) throw error
  if (typeof data !== 'string' || !isUuid(data)) throw new Error('DESK_NOT_UNLISTED')
  return buildPublicUrl(data, ownerTag)
}
