import { ProductSearchParams, ProductWithLinks, ShopLink } from '../types/product'
import { MockProductRepository } from './mockProductRepository'
import { PickLinkOptions, ProductRepository } from './productRepository'

// ─── Amazon Creators API 実装の骨組み ────────────────────────────
//
// 旧 Product Advertising API (PA-API v5) は 2026年4月末〜5月15日に廃止され、
// 後継の Creators API に置き換わった。新規に使うのはこちら。
//
// 【利用条件】承認済みアソシエイトアカウント + 過去30日間に10件以上の適格販売。
// 申し込むだけでは認証情報が出ず、売上が途切れるとアクセスも止まる。
// それまでは通常のアソシエイトリンク（https://www.amazon.co.jp/dp/{ASIN}?tag={ID}）を
// shop_links に shop='amazon_jp' で入れておけば購入導線は動く。
// productRepository.ts の pickShopLinks が Amazon → 楽天の順に並べて両方出す。
//
// レスポンス → 共通型のマッピング（項目名は PA-API v5 から大きくは変わらない）:
//   Product.asin        ← ASIN
//   Product.name        ← ItemInfo.Title
//   Product.brand       ← ItemInfo.ByLineInfo.Brand
//   Product.image       ← Images.Primary.Large.URL
//   ShopLink.price      ← Offers.Listings[0].Price.Amount
//   ShopLink.inStock    ← Offers.Listings[0].Availability
//   ShopLink.affiliateUrl ← DetailPageURL（PartnerTag 付き）
//
// 実装方針:
// ・認証情報をアプリに埋め込まない。楽天と同じく scripts/ から手元PCで叩いて
//   Supabase の products / shop_links へ入れる（scripts/importRakuten.ts を流用できる）。
// ・楽天と違い呼び出し元IPの固定は要求されないので、Cloudflare Worker から
//   実行時に叩く構成も選べる。
// ・ASIN で商品を一意に同定できるため、楽天でやった商品名の曖昧照合
//   （型番の一致率判定・アクセサリ除外）はほぼ不要になる。

export class AmazonProductRepository implements ProductRepository {
  // TODO(Creators API): 認証情報が発行できたら実装する。
  // それまではモックデータで同じインターフェースを満たす。
  private fallback = new MockProductRepository()

  async search(params: ProductSearchParams): Promise<ProductWithLinks[]> {
    return this.fallback.search(params)
  }

  async getById(id: string): Promise<ProductWithLinks | null> {
    return this.fallback.getById(id)
  }

  async findShopLinks(name: string, opts?: PickLinkOptions): Promise<ShopLink[]> {
    return this.fallback.findShopLinks(name, opts)
  }
}
