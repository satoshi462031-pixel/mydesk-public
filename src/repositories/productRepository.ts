import { CountryCode, ProductSearchParams, ProductWithLinks, PurchaseLink, ShopId, ShopLink } from '../types/product'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { normalizeHttpUrl, withoutAffiliateUrl } from '../utils/url'

// ─── ProductRepository ───────────────────────────────────────────
//
// 商品検索の取得元を差し替え可能にする Repository インターフェース。
// UI・画面コンポーネントはこのインターフェースと types/product.ts のみに
// 依存し、実装（Supabase / PA-API / モック）を知らないこと。
//
// 取得元の切り替えは下の PRODUCT_SOURCE を変えるだけ。

export interface ProductRepository {
  /** 商品検索（検索 → 商品選択 → デスクへ追加 の入口） */
  search(params: ProductSearchParams): Promise<ProductWithLinks[]>
  /** ID 指定で1件取得 */
  getById(id: string): Promise<ProductWithLinks | null>
  /**
   * 商品名からショップリンクを返す。ショップごとに1本、優先度順。
   * productId を持たない旧データの購入リンクを引くために使う。
   * 見つからなければ空配列（UI は何もしない）。
   */
  findShopLinks(name: string, opts?: PickLinkOptions): Promise<ShopLink[]>
}

/**
 * ショップの優先順位。数字が大きいほど優先。
 * Amazon を先にするのは、同じ商品でも商品ページが整っていて
 * 価格・在庫が確実なため。Amazon に無いものを楽天で拾う。
 */
const SHOP_PRIORITY: Record<ShopId, number> = {
  amazon_jp: 4,
  amazon_us: 4,
  rakuten_jp: 3,
  yahoo_jp: 2,
  official: 1,
}

export type PickLinkOptions = {
  country?: CountryCode
  /** ユーザーが優先ショップを選べるようにしたときはここへ渡す */
  preferredShop?: ShopId
}

export type ResolvePurchaseUrlOptions = PickLinkOptions & {
  /** 公開ページではユーザー入力URLや検索フォールバックを使わず、商品マスタだけを参照する */
  catalogOnly?: boolean
}

/**
 * 開けるリンクをショップごとに1本ずつ、出す順に並べて返す。
 * 国 → 優先ショップ → アフィリエイト有無 → ショップ優先度 の順で重みを付ける。
 */
export function pickShopLinks(
  links: ShopLink[],
  countryOrOptions: CountryCode | PickLinkOptions = 'JP',
): ShopLink[] {
  // 出せる URL で判定する。報酬の印を外せないリンクをここで選ぶと、同じショップの
  // 別のリンクがあってもそのショップのボタンごと消える
  const validLinks = links.filter((link) => resolvedShopUrl(link))
  if (validLinks.length === 0) return []
  const opts: PickLinkOptions =
    typeof countryOrOptions === 'string' ? { country: countryOrOptions } : countryOrOptions
  const country = opts.country ?? 'JP'

  const score = (l: ShopLink) =>
    (l.country === country ? 100 : 0) +
    (opts.preferredShop && l.shop === opts.preferredShop ? 50 : 0) +
    (normalizeHttpUrl(l.affiliateUrl) ? 10 : 0) +
    (SHOP_PRIORITY[l.shop] ?? 0)

  // 同じショップの行が複数あってもボタンは1つ。並び順は上の重み付けのまま
  const seen = new Set<ShopId>()
  return [...validLinks]
    .sort((a, b) => score(b) - score(a))
    .filter((link) => {
      if (seen.has(link.shop)) return false
      seen.add(link.shop)
      return true
    })
}

function resolvedShopUrl(link: ShopLink | null): string | null {
  if (!link) return null
  return purchaseUrlForDisplay(normalizeHttpUrl(link.affiliateUrl))
    ?? purchaseUrlForDisplay(normalizeHttpUrl(link.officialUrl))
}

/**
 * 購入リンクに成果報酬を付けるか。最初のリリースでは付けない。
 * 報酬を付けると広告表示とアソシエイト規約への対応が要り、Amazon は審査に売上の実績が要る。
 * Amazon を入れるときに楽天と一緒に始める。
 *
 * 付けるときは true にして、EXPO_PUBLIC_RAKUTEN_RAFCID・EXPO_PUBLIC_AMAZON_ASSOCIATE_TAG(_JP) を入れる。
 * 商品マスタ（shop_links.affiliate_url）・プリセット・保存済みのガジェットの URL には報酬付きのものが
 * 既に入っているので、ID を空にするだけでは止まらない。出す直前に外す
 */
export const AFFILIATE_LINKS_ENABLED = false

/** 画面に出す・開く購入 URL。報酬を付けない間は印を外し、外せないものは出さない */
export function purchaseUrlForDisplay(url: string | null): string | null {
  if (!url || AFFILIATE_LINKS_ENABLED) return url
  return withoutAffiliateUrl(url)
}

// ─── 取得元の切り替え ────────────────────────────────────────────

export type ProductSource = 'mock' | 'supabase' | 'amazon'

// 'supabase': scripts/importRakuten.ts で投入した商品DBを引く（現行）
// 'mock': constants/gadgetPresets.ts のプリセット行をそのまま使う（取り込み前の状態に戻すとき）
// 'amazon': PA-API 利用開始後（UI変更不要）
const PRODUCT_SOURCE: ProductSource = 'supabase'

type PurchaseTarget = { id?: string; url?: string; productId?: string; name: string }

// デモは機材構成の見本なので、同名の実商品の写真・購入先には結び付けない。
const isDemoGadget = (gadget: { id?: string }) => gadget.id?.startsWith('demo-') === true

/**
 * 解決済み購入リンクのメモリキャッシュ。
 * 商品マスタへの問い合わせは1画面あたり数百msかかり、その間ボタンが出ない。
 * 同じ商品を開き直すたびに待たせないよう、セッション中は引き直さない。
 * アプリを再起動すれば消えるので、商品マスタに Amazon リンクを足した場合も次回起動で反映される。
 */
const purchaseLinksCache = new Map<string, PurchaseLink[]>()

const purchaseCacheKey = (gadget: PurchaseTarget, country: CountryCode) =>
  `${country}|${gadget.productId ?? `name:${normalizedName(gadget.name)}`}`

const toPurchaseLinks = (links: ShopLink[]): PurchaseLink[] =>
  links.flatMap((link) => {
    const url = resolvedShopUrl(link)
    return url ? [{ shop: link.shop, url, kind: 'product' as const }] : []
  })

/**
 * 問い合わせ無しで即座に決まる購入リンク。ボタンを最初のフレームから出すために使う。
 *
 * 空配列には2つの意味があるので、UI は非同期版の結果で必ず上書きすること。
 * ・出してはいけない（商品未指定のプレースホルダー名）
 * ・まだ分からない（検索リンクを作れない国。Amazon タグ未設定の US）
 */
export function resolvePurchaseLinksSync(
  gadget: PurchaseTarget,
  opts: ResolvePurchaseUrlOptions = {},
): PurchaseLink[] {
  if (isDemoGadget(gadget)) return []
  const own = opts.catalogOnly ? null : purchaseUrlForDisplay(normalizeHttpUrl(gadget.url))
  if (own) return [{ shop: 'own', url: own, kind: 'product' }]
  if (opts.catalogOnly && !gadget.productId) return []
  if (!gadget.productId && isPlaceholderProductName(gadget.name)) return []

  const country = opts.country ?? 'JP'
  const cached = purchaseLinksCache.get(purchaseCacheKey(gadget, country))
  if (cached) return cached

  return opts.catalogOnly ? [] : shopSearchLinks(gadget.name, opts)
}

/**
 * ガジェットを開くときの購入リンクを決める。ショップごとに1本、Amazon → 楽天の順。
 *
 * 1. ユーザーが自分で入力した url（本人の意思を最優先。1本だけ）
 * 2. productId から商品マスタの最新リンク（複数ショップを並べる）
 * 3. productId が無い既存データは商品名で引く（後方互換）
 *
 * リンクを Gadget にコピーせずここで都度引くので、
 * shop_links に Amazon を足せば既存ガジェットにも反映される。
 */
export async function resolvePurchaseLinks(
  gadget: PurchaseTarget,
  opts: ResolvePurchaseUrlOptions = {},
): Promise<PurchaseLink[]> {
  if (isDemoGadget(gadget)) return []
  const own = opts.catalogOnly ? null : purchaseUrlForDisplay(normalizeHttpUrl(gadget.url))
  if (own) return [{ shop: 'own', url: own, kind: 'product' }]
  if (opts.catalogOnly && !gadget.productId) return []

  // 商品が特定できていないものにリンクを出すと、ユーザーが選んでもいない商品の
  // 購入ページへ誘導することになる。名前で引いても当たらないので問い合わせも省く
  if (!gadget.productId && isPlaceholderProductName(gadget.name)) return []

  const country = opts.country ?? 'JP'
  const cacheKey = purchaseCacheKey(gadget, country)
  const cached = purchaseLinksCache.get(cacheKey)
  if (cached) return cached

  const repo = getProductRepository()
  const resolved = await (async () => {
    try {
      if (gadget.productId) {
        const product = await repo.getById(gadget.productId)
        if (product) {
          const links = toPurchaseLinks(pickShopLinks(product.links, opts))
          if (links.length > 0) return links
        }
      }
      if (opts.catalogOnly) return []
      const links = toPurchaseLinks(await repo.findShopLinks(gadget.name, opts))
      if (links.length > 0) return links
    } catch {
      // 商品マスタを引けなくても、下の検索リンクで購入導線だけは残す
      return opts.catalogOnly ? [] : shopSearchLinks(gadget.name, opts)
    }
    return opts.catalogOnly ? [] : shopSearchLinks(gadget.name, opts)
  })()

  // 通信断で検索リンクへ落ちた結果を焼き付けると、復帰しても商品ページに戻らない
  if (resolved.length > 0 && resolved.every((link) => link.kind === 'product')) {
    purchaseLinksCache.set(cacheKey, resolved)
  }
  return resolved
}

/** 1本しか置けない場所（購入URL入力欄への自動入力）で使う */
export function resolvePurchaseUrlSync(
  gadget: PurchaseTarget,
  opts: ResolvePurchaseUrlOptions = {},
): string | null {
  return resolvePurchaseLinksSync(gadget, opts)[0]?.url ?? null
}

export async function resolvePurchaseUrl(
  gadget: PurchaseTarget,
  opts: ResolvePurchaseUrlOptions = {},
): Promise<string | null> {
  return (await resolvePurchaseLinks(gadget, opts))[0]?.url ?? null
}

/**
 * ガジェットに対応する商品マスタの行を決める。購入リンクと同じく Gadget には
 * 焼き付けず、開くたびに引く。後から取り込みで情報が付けば既存ガジェットにも出る。
 *
 * 1. productId から商品マスタ（予測変換で選んだガジェットはこれで決まる）
 * 2. productId が無い既存データは商品名で引く（後方互換）
 *
 * 画像とブランドで別々に引くと往復が倍になるので、解決はここ1本にまとめる。
 */
export async function resolveProduct(
  gadget: { id?: string; productId?: string; name: string; category?: string },
): Promise<{ image: string | null; brand: string | null } | null> {
  const repo = getProductRepository()
  try {
    // productId で引けた行に画像が無いときは名前一致へ落ちる（元からの挙動）。
    // ブランドはその行のものが正しいので、落ちる場合も持ち越す
    let brand: string | null = null
    if (gadget.productId) {
      const product = await repo.getById(gadget.productId)
      brand = product?.brand ?? null
      const image = normalizeHttpUrl(product?.image)
      if (image) return { image: isDemoGadget(gadget) ? null : image, brand }
    }
    const key = normalizedName(gadget.name)
    if (!key) return brand ? { image: null, brand } : null
    // 別商品の情報を出すと誤情報になるため、名前が完全に一致したものだけ採用する
    const products = await repo.search({ query: gadget.name, category: gadget.category, limit: 5 })
    const matched = products.find((product) => normalizedName(product.name) === key)
    if (!matched) return brand ? { image: null, brand } : null
    return { image: isDemoGadget(gadget) ? null : normalizeHttpUrl(matched.image) ?? null, brand: brand ?? matched.brand ?? null }
  } catch {
    return null
  }
}

/** 画像だけが要る呼び出し向け。解決の規則は resolveProduct と同じ */
export async function resolveProductImage(
  gadget: { id?: string; productId?: string; name: string; category?: string },
): Promise<string | null> {
  return (await resolveProduct(gadget))?.image ?? null
}

function normalizedName(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase()
}

/**
 * 商品名がプレースホルダー（カテゴリ名そのもの）かどうか。
 *
 * テンプレート適用で入るガジェットは「モニター」「モニター２」のようにカテゴリ表示名が
 * そのまま名前になる。商品を指定していない枠なので、購入リンクを出してはいけない。
 */
function isPlaceholderProductName(name: string): boolean {
  // 全角数字は NFKC で半角へ寄り、末尾の連番（モニター２）を落として比較する
  const key = name.normalize('NFKC').trim().replace(/[\s0-9]+$/, '').toLowerCase()
  if (!key) return true
  return PLACEHOLDER_NAMES.has(key)
}

const PLACEHOLDER_NAMES: Set<string> = new Set(
  [
    ...Object.values(CATEGORY_LABELS),
    ...Object.values(CATEGORY_LABELS_EN),
    // 商品ではなく種類を表すだけのプリセット行
    'ノートパソコン',
    'デスクトップPC',
    'ケーブルモデム',
    '充電器を追加',
  ].map((label) => label.normalize('NFKC').trim().toLowerCase()),
)

/**
 * 商品マスタにリンクが無いときの逃げ道。
 * プリセット748件のうち約4割は shop_links が空で（楽天の照合が
 * MATCH_THRESHOLD に届かなかったもの）、空で返すと購入ボタンごと消える。
 * 主力商品ほどプリセットなので、そのままでは購入導線が最も太い経路で切れる。
 *
 * 商品ページ側の Amazon リンクは shop_links + pickShopLinks が担当する。
 * ここは検索結果ページなので、タグを入れた国だけ Amazon も並べる。
 */
const SHOP_SEARCH_LINKS: Record<CountryCode, (query: string) => PurchaseLink[]> = {
  JP: (query) => {
    const base = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`
    const rakuten: PurchaseLink = {
      shop: 'rakuten_jp',
      url: RAKUTEN_RAFCID ? `${base}?rafcid=${encodeURIComponent(RAKUTEN_RAFCID)}` : base,
      kind: 'search',
    }
    const amazon = amazonSearchUrl('JP', query)
    return amazon ? [{ shop: 'amazon_jp', url: amazon, kind: 'search' }, rakuten] : [rakuten]
  },
  US: (query) => {
    const amazon = amazonSearchUrl('US', query)
    return amazon ? [{ shop: 'amazon_us', url: amazon, kind: 'search' }] : []
  },
}

function shopSearchLinks(name: string, opts: PickLinkOptions): PurchaseLink[] {
  const query = searchKeyword(name)
  if (!query) return []
  return SHOP_SEARCH_LINKS[opts.country ?? 'JP']?.(query) ?? []
}

/** タグ未設定の国では出さない。報酬の付かない導線を先に増やさない */
function amazonSearchUrl(country: CountryCode, query: string): string | null {
  const tag = AMAZON_ASSOCIATE_TAG[country]
  if (!tag) return null
  const host = country === 'JP' ? 'www.amazon.co.jp' : 'www.amazon.com'
  return `https://${host}/s?k=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}`
}

/**
 * 検索に使う語。型番はメーカーの商品ページに載っていても出品側の商品名には
 * 書かれていないことが多く（サンワダイレクトの「100-ERD030」など）、そのまま
 * 投げると1件も出ない検索結果へ飛ばすことになる。型番は落として商品名で引く。
 */
function searchKeyword(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean)
  const kept = tokens.filter((token) => !isModelNumberToken(token))
  return (kept.length > 0 ? kept : tokens).join(' ')
}

/** 英数字が混ざる4文字以上を型番とみなす。「M4」「E7」のような世代表記は残す */
function isModelNumberToken(token: string): boolean {
  const t = token.normalize('NFKC')
  return /^[A-Za-z0-9][A-Za-z0-9-]{3,}$/.test(t) && /[0-9]/.test(t) && /[A-Za-z]/.test(t)
}

/** 検索URLに成果報酬を紐づける識別子。未設定でもリンクは出す（報酬が付かないだけ） */
const RAKUTEN_RAFCID = AFFILIATE_LINKS_ENABLED ? process.env.EXPO_PUBLIC_RAKUTEN_RAFCID ?? '' : ''
/**
 * Amazon アソシエイトのトラッキングID。日本(.co.jp)と米国(.com)はプログラムが別で
 * タグも別に発行される。片方のタグを他方のドメインに付けても報酬は付かない。
 */
const AMAZON_ASSOCIATE_TAG: Record<CountryCode, string> = AFFILIATE_LINKS_ENABLED
  ? {
      JP: process.env.EXPO_PUBLIC_AMAZON_ASSOCIATE_TAG_JP ?? '',
      US: process.env.EXPO_PUBLIC_AMAZON_ASSOCIATE_TAG ?? '',
    }
  : { JP: '', US: '' }

let instance: ProductRepository | null = null

export function getProductRepository(): ProductRepository {
  if (instance) return instance
  switch (PRODUCT_SOURCE) {
    case 'supabase':
      instance = new (require('./supabaseProductRepository').SupabaseProductRepository)()
      break
    case 'amazon':
      instance = new (require('./amazonProductRepository').AmazonProductRepository)()
      break
    default:
      instance = new (require('./mockProductRepository').MockProductRepository)()
  }
  return instance!
}
