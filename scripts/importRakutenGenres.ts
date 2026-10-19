/**
 * 楽天ジャンルから売れ筋上位を一括取り込み（手元PCから実行する）
 *
 *   npm run import:genres -- --list=0          # ジャンル階層を見る（対応表を作るとき）
 *   npm run import:genres -- --list=100026     # 指定ジャンルの子を見る
 *   npm run import:genres -- --dry-run         # 書き込まずに取得結果だけ見る
 *   npm run import:genres -- --pages=3         # 1ジャンルあたり何ページ取るか（30件/ページ）
 *   npm run import:genres -- --genre=565162    # 1ジャンルだけ試す
 *
 * importRakuten.ts が「手書きプリセット748件に楽天リンクを付ける」のに対し、
 * こちらは「楽天にある商品そのものを商品DBに増やす」。
 *
 * プリセット（source='preset'）は正規名として残したいので、
 * 同名の商品が来ても上書きしない（ignoreDuplicates）。
 */
import { GadgetCategory } from '../src/types'
import { brandFromName } from '../src/utils/brandIdentity'
import { productIdentity, sanitizeProductName } from '../src/utils/productName'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  chunk,
  createAdminClient,
  loadEnv,
  normalize,
  pickImage,
  RakutenItem,
  REQUEST_INTERVAL_MS,
  searchRakuten,
  sleep,
  USED_WORDS,
} from './importRakuten'

const GENRE_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibagt/api/IchibaGenre/Search/20260701'
const APP_ORIGIN = 'https://mydesk.page'

/**
 * 取り込む楽天ジャンルと、対応する GadgetCategory。
 * `--list=<genreId>` で階層を辿って追加できる（genreId=0 がルート）。
 * 楽天のジャンルは GadgetCategory より細かいので、近いものに寄せている。
 */
type ProductCategory = GadgetCategory

type TargetGenre = {
  genreId: string
  category: ProductCategory
  label: string
  subcategory?: string
  brandOptional?: boolean
}

const TARGET_GENRES: TargetGenre[] = [
  // ─── 親ジャンルより先に取る子ジャンル ───
  // 同じ商品は先に来たジャンルのカテゴリで入るので、ここは親より前に置く。
  // 親の売れ筋上位だけでは子ジャンルの商品がほとんど入らず、入っても親のカテゴリになっていた
  // （モニターアームが「家具」、ワイヤレス充電器が「モバイルバッテリー」、配線整理用品が
  // 「ケーブル」、スイッチングハブが「ルーター」）。実在のデスクツアーと突き合わせて見つかった
  { genreId: '566221', category: 'MonitorArm', label: 'モニターアーム', brandOptional: true },
  { genreId: '569471', category: 'Furniture', label: 'モニタースタンド', brandOptional: true },
  { genreId: '406680', category: 'Accessory', label: 'ノートPCスタンド', brandOptional: true },
  { genreId: '300851', category: 'Chair', label: '高機能チェア', brandOptional: true },
  { genreId: '300848', category: 'Chair', label: 'デスク用チェア', brandOptional: true },
  { genreId: '567248', category: 'Charger', label: 'ワイヤレス充電器' },
  { genreId: '564277', category: 'MobileBattery', label: 'モバイルバッテリー' },
  { genreId: '565249', category: 'Storage', label: '外付けSSDドライブ' },
  { genreId: '211492', category: 'Storage', label: '外付けハードディスクドライブ' },
  { genreId: '500281', category: 'Light', label: 'デスクライト・テーブルランプ', brandOptional: true },
  { genreId: '566460', category: 'Light', label: '間接照明', brandOptional: true },
  { genreId: '567180', category: 'Accessory', label: 'ケーブル整理用品', brandOptional: true },
  { genreId: '408484', category: 'NetworkSwitch', label: 'スイッチングハブ' },
  { genreId: '206045', category: 'AudioInterface', label: 'オーディオインターフェイス' },
  { genreId: '568336', category: 'Speaker', label: 'パワードスピーカー' },
  // 親ジャンルが取り込み対象に無かったもの
  { genreId: '301693', category: 'DeskPad', label: 'デスクマット', brandOptional: true },
  { genreId: '568643', category: 'Accessory', label: '有孔ボード・ペグボード', brandOptional: true },
  { genreId: '567529', category: 'Furniture', label: 'フットレスト', brandOptional: true },
  // パソコン・周辺機器 (100026)
  { genreId: '565162', category: 'PC', label: 'パソコン' },
  { genreId: '110105', category: 'Monitor', label: 'ディスプレイ' },
  { genreId: '560062', category: 'Storage', label: '外付けドライブ・ストレージ' },
  { genreId: '110080', category: 'Printer', label: 'プリンタ' },
  { genreId: '565170', category: 'Mouse', label: 'マウス' },
  { genreId: '560088', category: 'Keyboard', label: 'キーボード' },
  { genreId: '403503', category: 'Keyboard', label: 'テンキー' },
  { genreId: '211553', category: 'PenTablet', label: 'ペンタブレット' },
  { genreId: '552407', category: 'Hub', label: 'USBハブ' },
  { genreId: '567172', category: 'Dock', label: 'ドッキングステーション' },
  { genreId: '552481', category: 'PowerStrip', label: '電源タップ' },
  { genreId: '552468', category: 'Cable', label: 'ケーブル' },
  { genreId: '564421', category: 'Cable', label: '変換コネクタ・ケーブル' },
  { genreId: '552462', category: 'KVM', label: '切替機・分配器' },
  { genreId: '211577', category: 'UPS', label: '無停電電源装置' },
  { genreId: '403512', category: 'Webcam', label: 'ウェブカメラ' },
  { genreId: '568359', category: 'Headphone', label: 'ヘッドセット' },
  { genreId: '552391', category: 'MousePad', label: 'マウスパッド' },
  { genreId: '552396', category: 'Accessory', label: 'リストレスト' },
  { genreId: '552436', category: 'Charger', label: 'PC用ACアダプター' },
  // ネットワーク機器 (101451)
  { genreId: '565167', category: 'Router', label: '無線LAN' },
  { genreId: '100061', category: 'Modem', label: 'モデム・ターミナルアダプタ' },
  // ゲーム用機器 (567167)
  { genreId: '565171', category: 'Mouse', label: 'ゲーミングマウス' },
  { genreId: '567170', category: 'Keyboard', label: 'ゲーミングキーボード' },
  { genreId: '567169', category: 'Headphone', subcategory: 'gaming', label: 'ゲーミングヘッドセット' },
  { genreId: '211549', category: 'Controller', label: 'ゲームパッド' },
  // TV・オーディオ・カメラ (211742)
  { genreId: '502835', category: 'Headphone', label: 'ヘッドホン・イヤホン' },
  { genreId: '208316', category: 'Speaker', label: 'スピーカー' },
  { genreId: '507607', category: 'Speaker', label: 'ポータブルスピーカー' },
  { genreId: '566736', category: 'SmartHome', label: 'スマートスピーカー' },
  { genreId: '565058', category: 'HeadphoneAmp', label: 'アンプ' },
  { genreId: '567187', category: 'AudioInterface', label: 'DAコンバーター' },
  // スマートフォン・タブレット (564500)
  { genreId: '560202', category: 'Smartphone', label: 'スマートフォン本体' },
  { genreId: '560029', category: 'Tablet', label: 'タブレットPC本体' },
  { genreId: '564895', category: 'Smartwatch', label: 'スマートウォッチ本体' },
  { genreId: '566886', category: 'VRGlass', label: 'VRゴーグル' },
  { genreId: '509433', category: 'MobileBattery', label: 'バッテリー・充電器' },
  // インテリア (100804)
  { genreId: '200167', category: 'Desk', label: 'デスク', brandOptional: true },
  { genreId: '111363', category: 'Chair', label: 'イス・チェア', brandOptional: true },
  { genreId: '100805', category: 'Light', label: 'ライト・照明器具', brandOptional: true },
  // 楽器・音響機器 (112493)
  { genreId: '206024', category: 'AudioInterface', label: 'DAW・DTM・レコーダー' },
  // PA機器 (566955) は親のままだとマイクもスピーカーもアンプも Mixer に潰れるので、子で取る
  { genreId: '206038', category: 'Mixer', label: 'ミキサー' },
  { genreId: '406336', category: 'Microphone', label: 'マイク' },
  { genreId: '206031', category: 'MicArm', label: 'マイクスタンド' },
  { genreId: '569319', category: 'Accessory', label: 'ウインドスクリーン・ポップガード' },
  { genreId: '568294', category: 'Speaker', label: 'モニタースピーカー' },
  { genreId: '568295', category: 'HeadphoneAmp', label: 'パワーアンプ' },
  { genreId: '500247', category: 'Headphone', label: 'モニターヘッドホン' },
  { genreId: '566954', category: 'Instrument', label: 'ギター・ベース' },
  { genreId: '203018', category: 'Instrument', label: 'ピアノ・キーボード' },
  { genreId: '204228', category: 'Mixer', label: 'DJ機器' },
  // テレビゲーム (101205) — 本体。GadgetCategory の GameConsole がここまで空だった
  { genreId: '568771', category: 'GameConsole', label: 'Nintendo Switch 2' },
  { genreId: '565950', category: 'GameConsole', label: 'Nintendo Switch' },
  { genreId: '568375', category: 'GameConsole', label: 'プレイステーション5' },
  { genreId: '563544', category: 'GameConsole', label: 'プレイステーション4' },
  { genreId: '568382', category: 'GameConsole', label: 'Xbox Series X/S' },
  { genreId: '553848', category: 'GameConsole', label: 'Nintendo 3DS・2DS' },
  // PCパーツ (100087)
  { genreId: '408515', category: 'PCPart', subcategory: 'storage', label: '内蔵ドライブ・ストレージ' },
  { genreId: '565174', category: 'PCPart', subcategory: 'memory', label: '増設メモリ' },
  { genreId: '211582', category: 'PCPart', subcategory: 'cpu', label: 'CPU' },
  { genreId: '100081', category: 'PCPart', subcategory: 'gpu', label: 'グラフィックボード' },
  { genreId: '211607', category: 'PCPart', subcategory: 'motherboard', label: 'マザーボード' },
  { genreId: '211592', category: 'PCPart', subcategory: 'case', label: 'PCケース・筐体' },
  { genreId: '567179', category: 'PCPart', subcategory: 'cooling', label: '冷却パーツ' },
  { genreId: '565175', category: 'PCPart', subcategory: 'power_supply', label: 'PCケース用電源' },
  { genreId: '408533', category: 'CaptureDevice', label: 'ビデオキャプチャ' },
  { genreId: '211605', category: 'AudioInterface', label: 'サウンドカード' },
  { genreId: '211597', category: 'CaptureDevice', label: 'PC用TVチューナー' },
  // カメラ (100212)
  { genreId: '100083', category: 'SmallDevice', label: 'デジタルカメラ' },
  // TV・オーディオ (211742) の残り
  { genreId: '563843', category: 'TV', label: 'テレビ' },
  { genreId: '202952', category: 'Projector', subcategory: 'home', label: 'ホームプロジェクター' },
  { genreId: '567843', category: 'Projector', subcategory: 'portable', label: 'ポータブルプロジェクター' },
  { genreId: '213198', category: 'Microphone', label: 'ICレコーダー' },
  { genreId: '503285', category: 'Storage', label: 'メモリーカード' },
  { genreId: '568567', category: 'Speaker', label: 'サウンドバー' },
  { genreId: '200147', category: 'SmallDevice', label: 'ポータブルオーディオプレーヤー' },
  // PC周辺の残り (100094 / 101451 / 100026)
  { genreId: '552446', category: 'Accessory', label: 'USBグッズ' },
  { genreId: '552420', category: 'MobileBattery', label: 'ノートPC用バッテリー' },
  { genreId: '567173', category: 'Accessory', label: '冷却パッド・ノートPCクーラー' },
  { genreId: '565168', category: 'Router', label: '有線LAN' },
  { genreId: '568560', category: 'SmallDevice', label: 'ICカードリーダー' },
  { genreId: '211546', category: 'Accessory', label: 'セキュリティワイヤーロック' },
  // スマホ・タブレット (564500) の残り
  { genreId: '408507', category: 'Headphone', label: 'ヘッドセット・イヤホンマイク' },
  { genreId: '560313', category: 'Tablet', label: '電子書籍リーダー本体' },
  { genreId: '567219', category: 'StreamingDevice', subcategory: 'streaming', label: 'メディアストリーミング端末' },
  { genreId: '560050', category: 'Accessory', label: 'タブレットPCアクセサリー' },
  { genreId: '567845', category: 'SmartHome', label: 'スマートリモコン' },
  { genreId: '560283', category: 'Accessory', label: 'スマートフォンスタンド' },
  // インテリア (100804) の残り
  { genreId: '205737', category: 'Desk', label: 'オフィスデスク・テーブル', brandOptional: true },
  { genreId: '205739', category: 'Chair', label: 'オフィスチェア', brandOptional: true },
  { genreId: '205725', category: 'Furniture', label: 'オフィス収納', brandOptional: true },
  { genreId: '400811', category: 'Furniture', label: '応接セット', brandOptional: true },
  { genreId: '205728', category: 'Furniture', label: '役員用家具セット', brandOptional: true },
  { genreId: '205738', category: 'Furniture', label: 'パーテーション', brandOptional: true },
  { genreId: '215780', category: 'Furniture', label: 'スモーキング用スタンド', brandOptional: true },
  { genreId: '568202', category: 'Furniture', label: '家具用連結金具', brandOptional: true },
  { genreId: '200112', category: 'Furniture', label: 'その他のオフィス家具', brandOptional: true },
  // 配線を持たない「飾り」を置く導線があるので、置物・時計も候補に入れる
  { genreId: '100863', category: 'Accessory', label: 'インテリア小物・置物', brandOptional: true },
  { genreId: '100857', category: 'SmallDevice', label: '置き時計・掛け時計', brandOptional: true },
  { genreId: '207738', category: 'SmallDevice', label: '温度計・湿度計', brandOptional: true },
  // デスク周りの小物・保護用品
  { genreId: '211543', category: 'Accessory', label: '液晶保護フィルム' },
  { genreId: '211542', category: 'Accessory', label: 'プライバシーフィルター' },
  // 映像まわり。HDMIに直挿しするドングル型（Port.directAttach の代表例）
  { genreId: '565247', category: 'StreamingDevice', subcategory: 'wireless_display', label: 'ワイヤレスディスプレイアダプタ' },
  { genreId: '568605', category: 'Projector', label: 'データプロジェクター' },
  { genreId: '212988', category: 'Speaker', label: 'ホームシアターシステム' },
  // 3Dプリンターは プリンタ (110080) ではなく DIY・工具 (100890) の下にある
  { genreId: '567764', category: 'Printer3D', label: '3Dプリンター' },
  // デスクに置く飾り（配線を持たない displayOnly 向け）
  { genreId: '202513', category: 'Plant', label: '観葉植物', brandOptional: true },
  { genreId: '567231', category: 'Plant', label: '造花・人工観葉植物', brandOptional: true },
  { genreId: '568696', category: 'Plant', label: '苔テラリウム', brandOptional: true },
  { genreId: '215202', category: 'Plant', label: '盆栽', brandOptional: true },
  { genreId: '566195', category: 'WallPanel', label: 'アートパネル・アートボード', brandOptional: true },
]

// ─── 引数 ────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const getOpt = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const DRY_RUN = hasFlag('dry-run')
const LIST = getOpt('list')
const ONE_GENRE = getOpt('genre')
const PAGES = Math.max(1, Number(getOpt('pages') ?? '3'))

// ─── ジャンルAPI ─────────────────────────────────────────────────

type Genre = { genreId: number; genreName: string; genreLevel: number }

/** formatVersion=2 は素の配列、1 は { child: {...} } でくるので両方受ける */
function toGenres(raw: unknown): Genre[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => {
      const o = (r as Record<string, unknown>) ?? {}
      const inner = (o.child ?? o.current ?? o.parent ?? o) as Record<string, unknown>
      return {
        genreId: Number(inner.genreId),
        genreName: String(inner.nameJa ?? inner.genreName ?? ''),
        genreLevel: Number(inner.level ?? inner.genreLevel ?? 0),
      }
    })
    .filter((g) => Number.isFinite(g.genreId) && g.genreName)
}

async function fetchChildren(genreId: string): Promise<Genre[]> {
  const params = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APP_ID!,
    genreId,
    format: 'json',
    formatVersion: '2',
  })
  const res = await fetch(`${GENRE_ENDPOINT}?${params}`, {
    headers: { accessKey: process.env.RAKUTEN_ACCESS_KEY!, Origin: APP_ORIGIN },
  })
  if (!res.ok) {
    throw new Error(`ジャンルAPI エラー ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  const json = (await res.json()) as { children?: unknown }
  return toGenres(json.children)
}

// ─── 商品名の整形 ────────────────────────────────────────────────

/** 宣伝文句を落として、商品を識別できる名前にする */
export function cleanItemName(raw: string): string {
  return sanitizeProductName(raw)
}

/**
 * 楽天の「ヘッドホン・イヤホン」(502835) は葉で、イヤホン専用のジャンルが存在しない。
 * このまま Headphone へ流すと Earphone の予測変換が永久に空のままになるので、
 * 商品名から耳に入れる型（カナル・インイヤー・完全ワイヤレス）を拾って振り分ける。
 *
 * 「ヘッドホン」を含むならイヤホン語があっても Headphone を優先する
 * （「ヘッドホン イヤホン 両対応」のような併記が多いため）。
 */
const EARPHONE_WORDS = /イヤホン|イヤフォン|イヤーフォン|カナル|インイヤー|earbuds?|earphones?|完全ワイヤレス|左右分離|ネックバンド/i
const HEADPHONE_WORDS = /ヘッドホン|ヘッドフォン|headphones?|オーバーイヤー|オンイヤー|密閉型|開放型/i

/** ジャンルだけでは分けられないものを商品名で振り直す */
function refineCategory(category: ProductCategory, name: string): ProductCategory {
  if (category !== 'Headphone') return category
  if (HEADPHONE_WORDS.test(name)) return 'Headphone'
  return EARPHONE_WORDS.test(name) ? 'Earphone' : 'Headphone'
}

/** 予測変換の候補として使い物になるか */
function isUsableName(name: string, strict = false): boolean {
  if (name.length < 4) return false
  // 記号だけの名前を落とす。漢字・ひらがなだけの商品名も正しく受け入れる。
  if (!/[\p{L}\p{N}]/u.test(name)) return false
  if (!strict) return true

  const words = name.split(/\s+/).filter(Boolean)
  // ブランドなしの商品は、短いSEOキーワードを大量に並べた説明文を候補に入れない。
  if (words.length > 12) return false
  if (/^(?:new|sale|free)\b/i.test(name)) return false
  if (/\d+\s*円以上.*(?:注文|購入)|(?:注文|購入).*(?:の方|限定)|お一人様|プレゼント|おまけ|当選確率|この価格|追加送料|お届け地域/i.test(name)) return false
  const symbols = [...name].filter((c) => !/[\p{L}\p{N}\s]/u.test(c)).length
  return symbols / name.length <= 0.2
}

// ─── 取り込み ────────────────────────────────────────────────────

type Row = {
  name: string
  brand: string | null
  category: ProductCategory
  subcategory?: string
  image?: string
  item: RakutenItem
}

type ExistingProduct = {
  id: string
  name: string
  brand: string | null
  category: string | null
  subcategory: string | null
  image: string | null
  source: string | null
  shop_links: Array<{
    id: string
    shop: string
    affiliate_url: string | null
    official_url: string | null
    price: number | null
    currency: string | null
    in_stock: boolean | null
    review_count: number | null
    last_updated: string
  }>
}

function itemUrlKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return undefined
  }
}

function comparisonTokens(value: string): Set<string> {
  return new Set(
    normalize(sanitizeProductName(value))
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2),
  )
}

function identityScore(existing: ExistingProduct, current: Row): number {
  const oldTokens = comparisonTokens(existing.name)
  const newTokens = comparisonTokens(current.name)
  if (oldTokens.size === 0 || newTokens.size === 0) return 0
  const overlap = [...oldTokens].filter((token) => newTokens.has(token)).length / oldTokens.size
  const brandMatch = existing.brand && current.brand
    ? normalize(existing.brand) === normalize(current.brand)
    : false
  const categoryMatch = existing.category === current.category
  return overlap * 0.8 + (brandMatch ? 0.15 : 0) + (categoryMatch ? 0.05 : 0)
}

async function loadExistingProducts(db: NonNullable<ReturnType<typeof createAdminClient>>): Promise<ExistingProduct[]> {
  const products: ExistingProduct[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, name, brand, category, image, source, shop_links(id, shop, affiliate_url, official_url, price, currency, in_stock, review_count, last_updated)')
      .range(from, from + 999)
    if (error) throw new Error(`既存 products の取得に失敗: ${error.message}`)
    products.push(...((data ?? []) as ExistingProduct[]))
    if (!data || data.length < 1000) break
  }
  return products
}

async function repairExistingProducts(
  db: NonNullable<ReturnType<typeof createAdminClient>>,
  rows: Row[],
): Promise<number> {
  const allExisting = await loadExistingProducts(db)
  const existing = allExisting.filter((product) => product.source === 'rakuten')
  const byUrl = new Map<string, ExistingProduct[]>()
  const ownerByName = new Map(allExisting.map((product) => [product.name, product.id]))
  for (const product of existing) {
    for (const link of product.shop_links) {
      if (link.shop !== 'rakuten_jp') continue
      const key = itemUrlKey(link.official_url)
      if (!key) continue
      const products = byUrl.get(key) ?? []
      products.push(product)
      byUrl.set(key, products)
    }
  }

  const usedIds = new Set<string>()
  const repairs: Array<{ existing: ExistingProduct; current: Row; score: number }> = []
  for (const row of rows) {
    const key = itemUrlKey(row.item.itemUrl)
    if (!key) continue
    const best = (byUrl.get(key) ?? [])
      .filter((product) => !usedIds.has(product.id))
      .map((product) => ({ product, score: identityScore(product, row) }))
      .sort((a, b) => b.score - a.score)[0]
    if (!best || best.score < 0.72) continue
    const nameOwner = ownerByName.get(row.name)
    if (nameOwner && nameOwner !== best.product.id) continue
    usedIds.add(best.product.id)
    if (
      best.product.name === row.name &&
      best.product.brand === row.brand &&
      best.product.category === row.category
      && best.product.subcategory === (row.subcategory ?? null)
    ) continue
    repairs.push({ existing: best.product, current: row, score: best.score })
  }

  if (repairs.length === 0) {
    console.log('既存商品の商品名補完: 対象なし')
    return 0
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `rakuten-products-before-repair-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(repairs.map(({ existing, current, score }) => ({
    score,
    before: existing,
    after: {
      name: current.name,
      brand: current.brand,
      category: current.category,
      subcategory: current.subcategory ?? null,
      image: current.image ?? null,
    },
  })), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  for (const part of chunk(repairs, 100)) {
    const { error } = await db.from('products').upsert(
      part.map(({ existing: product, current }) => ({
        id: product.id,
        name: current.name,
        product_name: productIdentity(current.name, current.brand).productName,
        brand: current.brand,
        category: current.category,
        subcategory: current.subcategory ?? null,
        image: current.image ?? product.image,
        source: 'rakuten',
      })),
      { onConflict: 'id' },
    )
    if (error) throw new Error(`既存 products の商品名補完に失敗: ${error.message}`)
  }
  console.log(`既存商品の商品名補完: ${repairs.length}件`)
  return repairs.length
}

async function collectGenre(
  genreId: string,
  category: ProductCategory,
  brandOptional = false,
  subcategory?: string,
): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 1; page <= PAGES; page++) {
    const items = await searchRakuten({ genreId, sort: '-reviewCount', page })
    await sleep(REQUEST_INTERVAL_MS)
    if (!items || items.length === 0) break
    for (const item of items) {
      // 中古はリンクが1点物ですぐ消えるので、商品マスタには入れない
      if (USED_WORDS.some((w) => normalize(item.itemName).includes(normalize(w)))) continue
      const cleanedName = cleanItemName(item.itemName)
      if (!isUsableName(cleanedName, brandOptional)) continue
      const brand = brandFromName(cleanedName)
      if (!brand && !brandOptional) continue
      rows.push({
        name: cleanedName,
        brand: brand ?? null,
        category: refineCategory(category, cleanedName),
        subcategory,
        image: pickImage(item),
        item,
      })
    }
  }
  return rows
}

async function main(): Promise<void> {
  loadEnv()

  if (LIST !== undefined) {
    const children = await fetchChildren(LIST)
    console.log(`genreId=${LIST} の子ジャンル ${children.length} 件\n`)
    for (const g of children) {
      console.log(`  ${String(g.genreId).padEnd(10)} L${g.genreLevel}  ${g.genreName}`)
    }
    return
  }

  const configuredGenre = ONE_GENRE
    ? TARGET_GENRES.find((target) => target.genreId === ONE_GENRE)
    : undefined
  const targets: TargetGenre[] = ONE_GENRE
    ? [configuredGenre ?? { genreId: ONE_GENRE, category: 'Other', label: ONE_GENRE }]
    : TARGET_GENRES

  if (targets.length === 0) {
    throw new Error(
      'TARGET_GENRES が空。--list=0 からジャンルを辿って scripts/importRakutenGenres.ts に対応表を書く',
    )
  }

  const db = DRY_RUN ? null : createAdminClient()
  const byName = new Map<string, Row>()

  for (const [i, t] of targets.entries()) {
    const rows = await collectGenre(t.genreId, t.category, t.brandOptional, t.subcategory)
    let added = 0
    for (const r of rows) {
      // レビュー数降順で取っているので、同名なら先に来た方が人気商品
      if (!byName.has(r.name)) {
        byName.set(r.name, r)
        added++
      }
    }
    // refineCategory で振り分けたジャンルは、対応表の category と実際の内訳がずれる
    const refined = rows.filter((r) => r.category !== t.category)
    const refinedNote = refined.length > 0
      ? `（うち ${refined.length}件を ${[...new Set(refined.map((r) => r.category))].join('/')} へ振り分け）`
      : ''
    const unbranded = rows.filter((r) => r.brand === null).length
    const brandNote = unbranded > 0 ? `（ブランドなし ${unbranded}件）` : ''
    console.log(
      `[${i + 1}/${targets.length}] ${t.label} (${t.category}) → ${rows.length}件中 ${added}件が新規${refinedNote}${brandNote}`,
    )
  }

  const all = [...byName.values()]
  console.log(`\n重複除去後 ${all.length} 件${DRY_RUN ? '（dry-run: 書き込まない）' : ''}`)
  if (DRY_RUN) {
    for (const r of all.slice(0, 30)) {
      console.log(`  ¥${String(r.item.itemPrice).padStart(8)}  ${r.name}`)
    }
    return
  }
  const snapshotDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(snapshotDir, { recursive: true })
  const snapshotStamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = resolve(snapshotDir, `rakuten-collection-${snapshotStamp}.json`)
  writeFileSync(snapshotPath, JSON.stringify(all, null, 2))
  console.log(`再取得スナップショット: ${snapshotPath}`)
  if (!db) return

  const repaired = await repairExistingProducts(db, all)

  // プリセット（source='preset'）と同名なら何もしない。正規名を壊さない。
  for (const part of chunk(all, 500)) {
    const { error } = await db.from('products').upsert(
      part.map((r) => ({
        name: r.name,
        product_name: productIdentity(r.name, r.brand).productName,
        brand: r.brand,
        category: r.category,
        subcategory: r.subcategory ?? null,
        image: r.image ?? null,
        source: 'rakuten',
      })),
      { onConflict: 'name', ignoreDuplicates: true },
    )
    if (error) throw new Error(`products の投入に失敗: ${error.message}`)
  }

  // 商品名で .in() を投げると PostgREST は GET のクエリ文字列に載せるため、
  // 日本語名を数百件渡した時点で Bad Request になる。
  // source='rakuten' を全件ページングで引いて突き合わせる。
  // プリセット側の行を拾わないので、その楽天リンクを壊すこともない
  // （プリセットのリンクは importRakuten.ts が管理している）。
  const productByName = new Map<string, { id: string; category: string | null }>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, name, category')
      .eq('source', 'rakuten')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    for (const row of data ?? []) productByName.set(row.name, { id: row.id, category: row.category })
    if (!data || data.length < 1000) break
  }

  // ignoreDuplicates で既存の楽天商品は上書きされないため、対応表を変更したカテゴリだけ別途移す。
  // source='rakuten' のIDだけを対象にするので、同名の手書きプリセットは変更しない。
  const categoryUpdates = new Map<ProductCategory, string[]>()
  for (const row of all) {
    const product = productByName.get(row.name)
    if (!product || product.category === row.category) continue
    const ids = categoryUpdates.get(row.category) ?? []
    ids.push(product.id)
    categoryUpdates.set(row.category, ids)
  }
  let reclassified = 0
  for (const [category, ids] of categoryUpdates) {
    for (const part of chunk(ids, 100)) {
      const { error } = await db.from('products').update({ category }).in('id', part)
      if (error) throw new Error(`products のカテゴリ更新に失敗: ${error.message}`)
      reclassified += part.length
    }
  }

  const now = new Date().toISOString()
  const links = all
    .filter((r) => productByName.has(r.name))
    .map((r) => ({
      product_id: productByName.get(r.name)!.id,
      shop: 'rakuten_jp',
      country: 'JP',
      affiliate_url: r.item.affiliateUrl ?? null,
      official_url: r.item.itemUrl,
      price: r.item.itemPrice,
      currency: 'JPY',
      in_stock: r.item.availability === 1,
      review_count: r.item.reviewCount ?? 0,
      last_updated: now,
    }))

  for (const part of chunk(links, 500)) {
    const { error } = await db
      .from('shop_links')
      .upsert(part, { onConflict: 'product_id,shop' })
    if (error) throw new Error(`shop_links の投入に失敗: ${error.message}`)
  }

  console.log(`products ${productByName.size} 件 / shop_links ${links.length} 件を登録（商品名補完 ${repaired} 件 / カテゴリ移動 ${reclassified} 件）`)
}

main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
