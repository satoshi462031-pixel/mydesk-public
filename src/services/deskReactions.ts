// 自分の公開デスクへの反応の取得と、ベルでどこまで見たかの記録（086）。
// 件数の意味づけは utils/deskReactions.ts に置く。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../supabase/client'
import { DeskReaction, reactionsCheckedAt, toDeskReactions } from '../utils/deskReactions'

// 次のアカウントへ引き継がない（localUserDataKeys に載せてある）
const SEEN_KEY = '@desk_reactions_seen_at'

export async function getMyDeskReactions(since: string | null = null): Promise<DeskReaction[]> {
  const { data, error } = await supabase.rpc('get_my_desk_reactions', { p_since: since })
  if (error) throw error
  return toDeskReactions(data)
}

async function getReactionsSeenAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

export async function markReactionsSeen(at: string): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, at).catch(() => {})
}

/**
 * ベル用。前に見たあとに付いたいいねを返す。
 * 初めて呼んだとき（基準が無い）は、これまでのいいねを全部「新しい」とは言わずに基準だけ作る。
 * 公開済みのデスクを持つ人が、この機能の入った版に上げた直後に一斉に並ぶのを防ぐ
 */
export async function loadReactionsSinceSeen(): Promise<DeskReaction[]> {
  const since = await getReactionsSeenAt()
  const reactions = await getMyDeskReactions(since)
  if (since === null) {
    const baseline = reactionsCheckedAt(reactions)
    if (baseline) await markReactionsSeen(baseline)
    return reactions.map((reaction) => ({ ...reaction, newLikeCount: 0 }))
  }
  return reactions
}
