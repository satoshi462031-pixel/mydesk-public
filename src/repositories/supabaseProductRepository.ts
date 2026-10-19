import { supabase } from '../supabase/client'
import { ProductRow, ShopLinkRow } from '../supabase/types'
import { CountryCode, ProductSearchParams, ProductWithLinks, ShopLink } from '../types/product'
import { Port } from '../types'
import { PickLinkOptions, pickShopLinks, ProductRepository } from './productRepository'
import { productIdentity } from '../utils/productName'

// Supabase 商品DB 実装（MVP の本番取得元）。
// テーブル定義は supabase/migrations/007_products.sql。
// 取得失敗時は throw せず空を返し、UI 側の分岐を不要にする。

const MOUSE_PAD_NAME = /マウス\s*パッド|mouse\s*pad/i
const DESK_MAT_NAME = /デスク\s*マット|desk\s*mat/i

function normalizedProductCategory(category: string | null, name: string): string | undefined {
  if (!category) return undefined
  if (category === 'DeskPad' && MOUSE_PAD_NAME.test(name) && !DESK_MAT_NAME.test(name)) return 'MousePad'
  // ヘッドセットはヘッドホンへ統合済み。商品DB の付け替え（reclassifyProductCategories）
  // が走るまでは旧カテゴリの行が残るので、読み出し側でも寄せる
  if (category === 'Headset') return 'Headphone'
  return category
}

function toShopLink(r: ShopLinkRow): ShopLink {
  return {
    id: r.id,
    productId: r.product_id,
    shop: r.shop as ShopLink['shop'],
    country: r.country as CountryCode,
    affiliateUrl: r.affiliate_url ?? undefined,
    officialUrl: r.official_url ?? undefined,
    price: r.price ?? undefined,
    currency: r.currency ?? undefined,
    inStock: r.in_stock ?? undefined,
    reviewCount: r.review_count ?? undefined,
    lastUpdated: r.last_updated,
  }
}

function toPorts(value: unknown): Port[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ports = value.filter((port): port is Port => {
    if (!port || typeof port !== 'object') return false
    const row = port as Partial<Port>
    return typeof row.id === 'string'
      && typeof row.type === 'string'
      && (row.direction === 'input' || row.direction === 'output' || row.direction === 'bidirectional')
      && typeof row.count === 'number'
      && Number.isInteger(row.count)
      && row.count > 0
  })
  return ports.length > 0 ? ports : undefined
}

function toProduct(r: ProductRow & { shop_links?: ShopLinkRow[] }): ProductWithLinks {
  const identity = productIdentity(r.name, r.brand, r.product_name, r.source === 'preset')
  return {
    id: r.id,
    asin: r.asin ?? undefined,
    name: identity.displayName,
    brand: identity.brand,
    productName: identity.productName,
    rawName: r.name,
    category: normalizedProductCategory(r.category, r.name),
    subcategory: r.subcategory ?? undefined,
    image: r.image ?? undefined,
    description: r.description ?? undefined,
    source: r.source ?? undefined,
    isSuggestable: r.is_suggestable,
    ports: toPorts(r.ports),
    specsSourceUrl: r.specs_source_url ?? undefined,
    specsVerifiedAt: r.specs_verified_at ?? undefined,
    links: (r.shop_links ?? []).map(toShopLink),
  }
}

// 詳細シートは購入リンクと商品画像を別々に引くため、同じ商品を続けて取りに行く。
// 開いている間だけ効けば十分なので、素の Map を上限付きで持つ。
const BY_ID_CACHE_MAX = 50
const byIdCache = new Map<string, ProductWithLinks>()

function rememberById(id: string, product: ProductWithLinks): void {
  if (byIdCache.size >= BY_ID_CACHE_MAX) {
    const oldest = byIdCache.keys().next().value
    if (oldest !== undefined) byIdCache.delete(oldest)
  }
  byIdCache.set(id, product)
}

/**
 * 検索結果の並び順。商品DBが1万件を超えたため、ilike の素の結果順では
 * 「マウス」のような一般語で何が上位に来るか制御できない。
 *
 *   1. プリセット（手書きの正規名）を最優先
 *   2. 前方一致を部分一致より優先（"Logi" なら "Logicool …" が先）
 *   3. レビュー件数の多い順
 *
 * レビュー件数は出品ページの数値で商品自体の人気とは一致しないが、
 * 上2つで決まらないときの弱い指標としては使える。
 */
function maxReviewCount(p: ProductWithLinks): number {
  return p.links.reduce((max, l) => Math.max(max, l.reviewCount ?? 0), 0)
}

function rankScore(p: ProductWithLinks, query: string): number {
  const preset = p.source === 'preset' ? 4 : 0
  const prefix = query && p.name.toLowerCase().startsWith(query.toLowerCase()) ? 1 : 0
  // 対数にするのは、前方一致が常に勝つと「マウス」でマウスパッドが
  // レビュー1771件のマウス本体より上に来るため。桁で効かせて釣り合わせる。
  return preset + prefix + Math.log10(maxReviewCount(p) + 1)
}

export class SupabaseProductRepository implements ProductRepository {
  async search(params: ProductSearchParams): Promise<ProductWithLinks[]> {
    try {
      // NFKC を通す。日本語入力では全角英数（ＨＨＫＢ）が普通に混ざるが、
      // products.name は半角で入っているので素のままだと ilike に当たらない
      // 空白は1つにまとめる。改行・タブ・連続した空白が混ざると、商品名の並びと一致しなくなる
      const query = params.query.normalize('NFKC').trim().replace(/\s+/g, ' ')
      const limit = params.limit ?? 20
      // 打った % と _ は文字として探す。素のまま渡すと ilike の任意の文字列・1文字になり、
      // 「%」だけで全件、「_」で無関係な商品が当たっていた
      const literal = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)

      const build = (patterns: string[]) => {
        let q = supabase
          .from('products')
          .select('*, shop_links(*)')
          .eq('is_suggestable', true)
        for (const pattern of patterns) q = q.ilike('name', pattern)
        q = q
          // 並べ替えは取得後に行うので、切られる前に多めに取る。切る前の並びは決めておく。
          // 決めないと、当たる行が多い短い語ではどの行が残るかが DB 任せになり、
          // 同じ語でも候補が毎回変わる。新しい商品を先に残す
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit * 3)
        if (params.category === 'DeskPad' || params.category === 'MousePad') {
          q = q.in('category', ['DeskPad', 'MousePad'])
        } else if (params.category === 'Headphone') {
          // 付け替え前の 'Headset' 行も拾わないと、ヘッドホンの予測変換から
          // ゲーミングヘッドセットが丸ごと消える
          q = q.in('category', ['Headphone', 'Headset'])
        } else if (params.category) {
          q = q.eq('category', params.category)
        }
        if (params.subcategory) q = q.eq('subcategory', params.subcategory)
        return q
      }

      // 前方一致は別クエリにする。ilike 一発では部分一致と区別できず、
      // 1万件の中から "Logi" で引いたとき Logicool 本体が埋もれる。
      // 部分一致は語ごとに当てる（語の順番を問わない。「Keys MX」でも MX Keys に当たる）
      const results = query
        ? await Promise.all([
            build([`${literal(query)}%`]),
            build(query.split(' ').map((term) => `%${literal(term)}%`)),
          ])
        : [await build(['%'])]

      const byId = new Map<string, ProductWithLinks>()
      for (const { data, error } of results) {
        if (error || !data) continue
        for (const row of data) if (!byId.has(row.id)) byId.set(row.id, toProduct(row))
      }

      return [...byId.values()]
        .filter((product) => !params.category || product.category === params.category)
        .sort(
          (a, b) => rankScore(b, query) - rankScore(a, query) || a.name.length - b.name.length
            || a.name.localeCompare(b.name),
        )
        .slice(0, limit)
    } catch {
      return []
    }
  }

  async getById(id: string): Promise<ProductWithLinks | null> {
    const cached = byIdCache.get(id)
    if (cached !== undefined) return cached
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, shop_links(*)')
        .eq('id', id)
        .maybeSingle()
      if (error || !data) return null
      const product = toProduct(data)
      rememberById(id, product)
      return product
    } catch {
      return null
    }
  }

  async findShopLinks(name: string, opts?: PickLinkOptions): Promise<ShopLink[]> {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, shop_links(*)')
        .eq('name', name)
        .maybeSingle()
      if (error || !data) return []
      return pickShopLinks(toProduct(data).links, { country: 'JP', ...opts })
    } catch {
      return []
    }
  }
}
