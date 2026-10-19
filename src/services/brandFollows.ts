// ─── お気に入りブランド（074）────────────────────────────────────
//
// 行が持つのは brandKey だけで、商品との関連は持たない。products.brand は
// 商品名から機械的に抜いた文字列で表記ゆれがあるため、関連を行で固定すると
// 表記ごとに別ブランドとして増える。引き当ては読むたびに brandIdentity の
// 別名表で行い、辞書を直せば過去のフォローにも効くようにしている（074 冒頭）。
import { supabase } from '../supabase/client'
import { UNIQUE_VIOLATION } from '../supabase/postgresErrors'
import type { ProductRow } from '../supabase/types'
import { brandAliases, brandKey, isAftermarketListing } from '../utils/brandIdentity'

const TABLE = 'brand_follows'

export interface BrandFollowRow {
  id: string
  brand_key: string
  brand_label: string
  created_at: string
}

export async function listBrandFollows(userId: string): Promise<BrandFollowRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, brand_key, brand_label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as BrandFollowRow[]
}

/**
 * フォローを追加する。すでにあれば何もしない。
 * `rawBrand` は商品に入っていた表記で、辞書に無いブランドの表示名になる。
 */
export async function followBrand(userId: string, rawBrand: string): Promise<void> {
  const key = brandKey(rawBrand)
  if (!key) return
  const { error } = await supabase.from(TABLE).insert({
    user_id: userId,
    brand_key: key,
    brand_label: rawBrand.trim(),
  })
  if (error && error.code !== UNIQUE_VIOLATION) throw error
}

export async function unfollowBrand(userId: string, key: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).eq('brand_key', key)
  if (error) throw error
}

/**
 * そのブランドの商品を引く。
 *
 * products.brand は表記ゆれを含むので、辞書が知っている別名すべてで
 * `in` を張る。辞書に無いブランドはキー自身しか手掛かりが無いため、
 * 大文字小文字だけ無視して当てる（`ilike` は1本しか張れないので or を使う）。
 */
export async function listProductsByBrand(key: string, limit = 60): Promise<ProductRow[]> {
  const aliases = brandAliases(key)
  let query = supabase
    .from('products')
    .select('*')
    .eq('is_suggestable', true)
    // 件数で切る前に並びを決める。決めないと、商品の多いブランドではどの行が残るかが
    // DB 任せになり、開くたびに棚の中身が入れ替わる。新しい商品を先に残す
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // 他社のアクセサリを落としたぶんだけ棚が減るので、多めに引いてから絞る。
    // 実測の脱落率は最大でも半分なので3倍あれば limit を割らない
    .limit(limit * 3)
  query = aliases.length > 0
    ? query.or(aliases.map((alias) => `brand.ilike.${alias}`).join(','))
    : query.ilike('brand', key)
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as ProductRow[])
    // 「Apple認証品」を名乗る他社タグ、WorldPlus の互換バッテリーなど、
    // そのメーカーの製品ではない行を棚から外す（brand 列は書き換えない）
    .filter((row) => !isAftermarketListing(row.name, key))
    // 画像がある行を先に出す。カタログとして並べる以上、絵の無い行が頭に来ると死んで見える
    .sort((a, b) => Number(!!b.image) - Number(!!a.image))
    .slice(0, limit)
}
