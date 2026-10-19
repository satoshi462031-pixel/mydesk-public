import { ALL_PRODUCT_PRESETS, NameSuggestion } from '../constants/gadgetPresets'
import { CountryCode, ProductSearchParams, ProductWithLinks, ShopId, ShopLink } from '../types/product'
import { PickLinkOptions, pickShopLinks, ProductRepository } from './productRepository'

// MVP 実装: gadgetPresets.ts のプリセット行（affiliateUrl 付き）を商品DBとして扱う。
// ネットワーク不要。商品を増やす・リンクを貼るのは gadgetPresets.ts の行編集だけ。

/** URL のホスト名からショップを推定する（1行記入で済ませるため） */
export function inferShop(url: string): { shop: ShopId; country: CountryCode } {
  if (/amazon\.co\.jp|amzn\.asia/.test(url)) return { shop: 'amazon_jp', country: 'JP' }
  if (/amazon\.com|amzn\.to/.test(url)) return { shop: 'amazon_us', country: 'US' }
  if (/rakuten\.co\.jp/.test(url)) return { shop: 'rakuten_jp', country: 'JP' }
  if (/yahoo\.co\.jp/.test(url)) return { shop: 'yahoo_jp', country: 'JP' }
  return { shop: 'official', country: 'JP' }
}

function toLinks(p: NameSuggestion): ShopLink[] {
  const links: ShopLink[] = []
  if (p.affiliateUrl) {
    const { shop, country } = inferShop(p.affiliateUrl)
    links.push({ id: `${p.name}:aff`, productId: p.name, shop, country, affiliateUrl: p.affiliateUrl, lastUpdated: '' })
  }
  if (p.officialUrl) {
    const { shop, country } = inferShop(p.officialUrl)
    links.push({ id: `${p.name}:off`, productId: p.name, shop, country, officialUrl: p.officialUrl, lastUpdated: '' })
  }
  return links
}

function toProduct(p: NameSuggestion): ProductWithLinks {
  const g = p as NameSuggestion & { category?: string }
  return {
    id: p.name,
    asin: p.asin,
    name: p.name,
    brand: p.brand,
    category: g.category,
    links: toLinks(p),
  }
}

export class MockProductRepository implements ProductRepository {
  async search(params: ProductSearchParams): Promise<ProductWithLinks[]> {
    const q = params.query.trim().toLowerCase()
    let pool = ALL_PRODUCT_PRESETS
    if (params.category) pool = pool.filter((p) => (p as { category?: string }).category === params.category)
    if (q) pool = pool.filter((p) => p.name.toLowerCase().includes(q))
    return pool.slice(0, params.limit ?? 20).map(toProduct)
  }

  async getById(id: string): Promise<ProductWithLinks | null> {
    const p = ALL_PRODUCT_PRESETS.find((x) => x.name === id)
    return p ? toProduct(p) : null
  }

  async findShopLinks(name: string, opts?: PickLinkOptions): Promise<ShopLink[]> {
    const p = ALL_PRODUCT_PRESETS.find((x) => x.name === name)
    if (!p) return []
    return pickShopLinks(toLinks(p), { country: 'JP', ...opts })
  }
}
