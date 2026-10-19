// ─── 欲しいものリスト（066）──────────────────────────────────────
//
// 「いいね」は作らない。他人の行は誰も読めない（select_own）ので集計が出ず、
// 保存と機能的に同じものになる。理由は 066 のマイグレーション冒頭に書いてある。
//
// **同一性は商品で、デスクではない。** 同じマウスを3人のデスクから保存しても
// 1件に畳まれる（066 の部分ユニーク索引）。desk_id は「どこで見つけたか」で、
// 出典が非公開化・削除されても行は残る。
import { supabase } from '../supabase/client'
import { UNIQUE_VIOLATION } from '../supabase/postgresErrors'
import type { GadgetBookmarkItem } from '../supabase/types'
import type { Gadget } from '../types'
import { truncateChars } from '../utils/truncateText'

const TABLE = 'gadget_bookmarks'

// 古いプリセットには UUID ではなく商品名を productId として持つものがある。
// products.id へ入れられる値だけを送る。
function databaseProductId(value?: string): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

/**
 * 同じ商品の行を引く。
 *
 * product_id が引けたものはそれだけで照合する（名前が違っても同じ商品）。
 * 引けないものは名前＋カテゴリ。ここで ilike を使わないのは、名前が本人の
 * 自由入力で、% や _ が入るとワイルドカードとして効いてしまうため。
 * 大文字小文字だけ違う行は DB 側の索引（lower）が弾き、下で 23505 として扱う。
 */
function selectSame(gadget: Gadget, userId: string) {
  const productId = databaseProductId(gadget.productId)
  const base = supabase.from(TABLE).select('id').eq('user_id', userId)
  return productId
    ? base.eq('product_id', productId)
    : base.is('product_id', null).eq('gadget_name', gadget.name).eq('gadget_category', gadget.category)
}

export async function isGadgetBookmarked(gadget: Gadget, userId: string): Promise<boolean> {
  const { data, error } = await selectSame(gadget, userId).maybeSingle()
  if (error) throw error
  return !!data
}

/**
 * 保存を切り替える。@returns 切り替えたあとの状態（true = 保存済み）
 * @param deskId 見つけた元の公開デスク。自分の持ち物から押したときは null
 */
export async function toggleGadgetBookmark(
  gadget: Gadget,
  userId: string,
  deskId: string | null,
): Promise<boolean> {
  const { data: existing, error: selectError } = await selectSame(gadget, userId).maybeSingle()
  if (selectError) throw selectError

  if (existing) {
    const { error } = await supabase.from(TABLE).delete().eq('id', existing.id).eq('user_id', userId)
    if (error) throw error
    return false
  }

  const { error } = await supabase.from(TABLE).insert({
    user_id: userId,
    product_id: databaseProductId(gadget.productId),
    gadget_name: truncateChars(gadget.name, 300),
    gadget_category: gadget.category,
    desk_id: deskId,
    gadget_id: deskId ? gadget.id : null,
  })
  // 別の綴りで同じ商品を保存済みだった場合。押した人から見れば保存されている
  if (error && error.code !== UNIQUE_VIOLATION) throw error
  return true
}

/**
 * 欲しいものリストを新しい順に返す。
 *
 * **出典が非公開でも落とさない。** desks は公開デスクしか読めないので
 * `desk` が null になるだけで、行そのものは残す。ここで捨てると、相手が
 * 非公開にしただけで自分の欲しいものが消える。
 */
export async function listGadgetBookmarks(userId: string, collectionId?: string): Promise<GadgetBookmarkItem[]> {
  let query = supabase
    .from(TABLE)
    .select(`
      id, desk_id, gadget_id, product_id, gadget_name, gadget_category, user_id, created_at,
      product:products ( id, name, brand, product_name, image ),
      desk:desks ( id, title, owner_name, owner_tag, visibility )
      ${collectionId ? ', saved_collection_items!inner(collection_id)' : ''}
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
  if (collectionId) query = query.eq('saved_collection_items.collection_id', collectionId)
  const items: GadgetBookmarkItem[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw error
    items.push(...((data ?? []) as unknown as GadgetBookmarkItem[]))
    if (!data || data.length < 500) return items
  }
}

export async function removeGadgetBookmark(id: string, userId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
}
