/**
 * 商品マスタ取り込みスクリプト（手元PCから実行する）
 *
 *   npm run import:products -- --dry-run          # 書き込まずに結果だけ見る
 *   npm run import:products -- --skip-rakuten     # プリセット投入のみ（楽天IDが無くても動く）
 *   npm run import:products -- --resume           # 楽天リンク未取得の商品だけ（中断からの再開）
 *   npm run import:products -- --only=MacBook     # 名前が部分一致する商品だけ
 *   npm run import:products -- --limit=20         # 先頭N件だけ（動作確認用）
 *
 * 楽天ウェブサービスは「許可されたIPアドレス」でAPI呼び出し元を固定する必要があり、
 * Cloudflare Worker / Supabase Edge Functions は送信元IPが固定できない。
 * そのため実行時にAPIを叩くのではなく、IPが固定できる手元PCから叩いて
 * Supabase の products / shop_links に入れておき、アプリは Supabase だけを読む。
 *
 * 処理は2段階:
 *   Step1  gadgetPresets.ts の全商品を products に upsert（+ プリセットが持つリンク）
 *   Step2  楽天商品検索APIで image / description / 価格 / rakuten_jp リンクを補完
 *
 * 何度実行しても行は増えない（products.name / (product_id, shop) が unique）。
 */
import { createClient } from '@supabase/supabase-js'
import { productIdentity } from '../src/utils/productName'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_PRODUCT_PRESETS, NameSuggestion } from '../src/constants/gadgetPresets'
import { inferShop } from '../src/repositories/mockProductRepository'

// ─── 設定 ────────────────────────────────────────────────────────

// 2026年2月のインフラ刷新で app.rakuten.co.jp は openapi.rakuten.co.jp に移行し
// （旧ドメインは2026/5/13廃止）、applicationId に加えて accessKey が必須になった。
const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701'

/** 登録したアプリURL。新仕様では Origin 不一致で403になる例が報告されている */
const APP_ORIGIN = 'https://mydesk.page'

/** 楽天APIのレート制限は概ね1req/s。下回ると429が返るので余裕を持たせる */
export const REQUEST_INTERVAL_MS = 1100

/** 商品名との一致率がこれ未満の検索結果は「別商品」とみなして捨てる */
const MATCH_THRESHOLD = 0.7

/** itemCaption は数千字入ることがあるので詰め込まない */
const DESCRIPTION_MAX = 300

// ─── .env 読み込み ───────────────────────────────────────────────
// dotenv を足さずに済ませる。KEY=VALUE 以外の記法は使っていない。

export function loadEnv(): void {
  let raw: string
  try {
    raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

// ─── 引数 ────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const hasFlag = (name: string) => args.includes(`--${name}`)
const getOpt = (name: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

const DRY_RUN = hasFlag('dry-run')
const SKIP_RAKUTEN = hasFlag('skip-rakuten')
const RESUME = hasFlag('resume')
const ONLY = getOpt('only')?.toLowerCase()
const LIMIT = Number(getOpt('limit') ?? '0') || 0

// ─── 商品名の正規化・照合 ────────────────────────────────────────

/** 全角英数を半角に落として比較可能にする（楽天の商品名は全角混じりが多い） */
export function normalize(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .trim()
}

/**
 * 括弧の中は商品名ではなく、一覧で見分けるための説明。
 * `Pixio PX279 Prime (27" QHD 165Hz)` をそのまま検索すると全語AND検索で0件になり、
 * 照合側でも `27` `165` の一致まで要求してしまって正しい商品を弾く。
 * ただしプリセット名が括弧だけで構成されることは無いので、空になったら元に戻す。
 */
export function stripDescriptor(name: string): string {
  const stripped = name.replace(/[（(][^）)]*[）)]/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped.length > 0 ? stripped : name
}

/**
 * 括弧の中でも世代・年式だけは商品を分ける情報。
 * `(2nd Gen)` `(2025)` を落としたまま照合すると AirPods Pro 2 の枠に
 * 初代が、Razer Blade 16 (2025) に前年モデルが入りうる。
 * 検索語からは外す（AND検索で0件になるため）が、照合では必ず要求する。
 */
export function generationMarkers(name: string): string[] {
  const out: string[] = []
  for (const m of name.matchAll(/[（(]([^）)]*)[）)]/g)) {
    const inner = normalize(m[1])
    const year = inner.match(/(?:19|20)\d{2}/)
    if (year) out.push(year[0])
    const gen = inner.match(/(\d+)\s*(?:st|nd|rd|th)?\s*gen/)
    if (gen) out.push(gen[1])
  }
  return out
}

/** 記号は区切りとして落とす（`14"` の引用符はインチ表記で、楽天側は「14インチ」と書く） */
function tokenize(name: string): string[] {
  return normalize(name)
    .split(/[^0-9a-z぀-ヿ一-鿿]+/)
    .filter((t) => t.length > 0)
}

/**
 * 本体の新品以外を示す語。型番を商品名に含む保護フィルムやリモコン部品が
 * 一致率1.00で引っかかり、価格が本体と桁違いになるのを防ぐ。
 * 中古を弾くのは、価格を出す以上は入手可能な新品を指したいため
 * （中古は在庫1点限りで、リンク先がすぐ消える）。
 * プリセット名自体に含まれる語は除外しない（モニターアームを探すときの「アーム」など）。
 */
/** 本体ではない周辺品・部品。常に除外する（価格が桁違いになり誤リンクになるため） */
export const PARTS_WORDS = [
  '保護フィルム', 'フィルム', 'カバー', 'ケース', 'スタンド', 'アーム',
  'ケーブル', '交換', '互換', '変換', 'アダプタ', 'クリーナー',
  'マウント', 'ブラケット', '延長', 'ホルダー', '収納', 'バッグ',
  'リモコン', '部品', 'パーツ', '基板',
  // 液晶保護フィルム系。「フィルム」を含まない商品名が多い
  // （MSI MAG274QRF-QD で ¥6,780 の保護シートを掴んでいた）
  '保護', 'ブルーライト', '反射防止', 'のぞき見', '覗き', '防指紋', 'ペーパーライク', '専用',
  'フィルター', 'プライバシー', 'スリーブ', 'ポーチ', 'シール', 'スキン', 'ドッキング',
  // スマートウォッチのバンド・充電器類
  'バンド', 'ベルト', 'ストラップ', '充電器', 'ドック', 'クレードル',
]

/**
 * 候補の価格が本体として妥当かを見る。
 * 型番を商品名に含むアクセサリは除外語だけでは取りこぼすが、
 * 本体より一桁安いという形で必ず現れる。検索結果の中央値を基準に外れ値を落とす。
 */
function priceMedian(items: RakutenItem[]): number {
  const prices = items.map((i) => i.itemPrice).filter((p) => p > 0).sort((a, b) => a - b)
  return prices.length > 0 ? prices[Math.floor(prices.length / 2)] : 0
}

function dropCheapOutliers(items: RakutenItem[]): RakutenItem[] {
  if (items.length < 4) return items
  const median = priceMedian(items)
  return items.filter((i) => i.itemPrice >= median * 0.25)
}

/** 中古・訳あり。新品が見つからない場合に限り採用し、価格は保存しない */
export const USED_WORDS = ['中古', 'ジャンク', '訳あり', 'リユース', '再生品', '美品', 'used']

export function hasWord(itemName: string, presetName: string, words: string[]): boolean {
  const item = normalize(itemName)
  const preset = normalize(presetName)
  return words.some((w) => {
    const word = normalize(w)
    // プリセット名自体に含まれる語は除外しない（モニターアームを探すときの「アーム」など）
    return item.includes(word) && !preset.includes(word)
  })
}

/** 'WH-1000XM5' 'U2725QE' のような型番。商品を一意に決めるので重く扱う */
function isModelNumber(token: string): boolean {
  return token.length >= 4 && /[0-9]/.test(token) && /[a-z]/.test(token)
}

/**
 * 検索結果が目的の商品かを 0..1 で採点する。
 * 楽天の検索は1位が別商品のことが普通にあり、そのまま採用すると
 * 全く違う商品の購入リンクを踏ませることになるため必ず通す。
 *
 * 型番に重みを置くのは、ブランド名が「ソニー」「ロジクール」とカナで書かれると
 * 必ず1トークン落ちるため。型番が一致していればそれが最も強い証拠になる。
 */
/**
 * 数字を含むトークンが、英数字に挟まれない形で商品名に現れるか。
 * '27up850' は '27up850n-w'（別モデル）に一致させず、
 * '14' は「14インチ」に一致させたいので、境界は英数字だけで判定する。
 */
function containsNumericToken(haystack: string, token: string): boolean {
  return new RegExp(`(?<![0-9a-z])${token}(?![0-9a-z])`).test(haystack)
}

function matchScore(presetName: string, itemName: string): number {
  const tokens = tokenize(stripDescriptor(presetName))
  if (tokens.length === 0) return 0
  const haystack = normalize(itemName)

  // 型番と世代（'27UP850' 'M4' 'Watch 3' の 3）は1つでも欠けたら別商品。
  // 'Pixel Watch 3' が 'Pixel Watch4' に、'APEX 2 Pro' が充電アダプタに
  // 一致してしまうのを語の一致率だけでは防げない。
  const numeric = tokens.filter((t) => /[0-9]/.test(t))
  if (!numeric.every((t) => containsNumericToken(haystack, t))) return 0

  // 括弧から外した世代・年式は、検索語には含めないが一致は必須にする
  if (!generationMarkers(presetName).every((g) => containsNumericToken(haystack, g))) return 0

  let total = 0
  let hit = 0
  for (const t of tokens) {
    const weight = isModelNumber(t) ? 2 : 1
    total += weight
    // 語トークンは「ロジクールMXMaster」のような連結表記があるので部分一致で拾う
    if (/[0-9]/.test(t) || haystack.includes(t)) hit += weight
  }
  return hit / total
}

/**
 * 「ノートパソコン」のようなカテゴリ名そのものの行を除く。
 * 特定商品ではないので、検索1位を購入リンクにすると無関係な安物が刺さる。
 * ヒューリスティック（日本語1語）で拾えないものはここに足す。
 */
const GENERIC_NAMES = new Set(['デスクトップPC'])

function isGenericName(name: string): boolean {
  if (GENERIC_NAMES.has(name)) return true
  const tokens = tokenize(name)
  return tokens.length === 1 && !/[0-9a-z]/.test(tokens[0])
}

// ─── 楽天API ─────────────────────────────────────────────────────

/** formatVersion=2 のレスポンス。必要な項目だけ拾う */
export type RakutenItem = {
  itemName: string
  itemCode: string
  itemPrice: number
  itemUrl: string
  affiliateUrl?: string
  imageFlag?: number
  mediumImageUrls?: (string | { imageUrl: string })[]
  itemCaption?: string
  availability?: number
  reviewCount?: number
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 検索キーワードを楽天が受け付ける形に整える。
 * `MacBook Pro 14" M4` の引用符や `27GR95QE (OLED)` の括弧をそのまま送ると
 * keyword is not valid で400になる。記号は空白に潰し、型番のハイフンだけ残す。
 */
function buildKeyword(preset: Preset): string {
  const raw = [preset.brand, stripDescriptor(preset.name)].filter(Boolean).join(' ')
  return raw
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(^|\s)-+/g, '$1') // 先頭のハイフンは楽天では除外検索の意味になる
    .trim()
    .split(' ')
    // 楽天は1文字の検索語を受け付けず400になる（'Logicool G Pro X Superlight 2' など）。
    // 落としても照合は元のプリセット名で行うので精度は落ちない。
    .filter((w) => w.length >= 2)
    .join(' ')
    .slice(0, 128)
}

export type RakutenQuery = {
  keyword?: string
  /** ジャンル一括取得（scripts/importRakutenGenres.ts）で使う */
  genreId?: string
  sort?: string
  page?: number
}

/** null はキーワードが楽天に受け付けられなかった（その商品はスキップ） */
export async function searchRakuten(query: RakutenQuery): Promise<RakutenItem[] | null> {
  const params = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APP_ID!,
    hits: '30', // 上限。中古や周辺品を除外しても新品本体が残るよう多めに取る
    format: 'json',
    formatVersion: '2',
    imageFlag: '1', // 画像なし商品を除く。画像が無いと一覧に出せない
  })
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.genreId) params.set('genreId', query.genreId)
  if (query.sort) params.set('sort', query.sort)
  if (query.page) params.set('page', String(query.page))
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID
  if (affiliateId) params.set('affiliateId', affiliateId)

  for (let attempt = 0; attempt < 5; attempt++) {
    // accessKey はヘッダーでもクエリでも通るが、URLに載せるとログに残るのでヘッダーで送る
    let res: Response
    try {
      res = await fetch(`${RAKUTEN_ENDPOINT}?${params}`, {
        headers: {
          accessKey: process.env.RAKUTEN_ACCESS_KEY!,
          Origin: APP_ORIGIN,
        },
      })
    } catch {
      // 瞬断や DNS の失敗。14分走らせる以上ここで止めない
      await sleep(3000 * (attempt + 1))
      continue
    }
    if (res.ok) {
      // 200 でも本文が空で返ってくることがある（748件通すと数回起きる）。
      // res.json() だと Unexpected end of JSON input で全体が止まるので自前で見る。
      const text = await res.text()
      try {
        if (text.trim()) {
          const json = JSON.parse(text) as { Items?: RakutenItem[] }
          return json.Items ?? []
        }
      } catch {
        // 壊れた JSON もリトライ対象にする
      }
      await sleep(2000 * (attempt + 1))
      continue
    }
    // 403 は「許可されたIPアドレス」の不一致がほぼ確実。待っても回復しないので即止める
    if (res.status === 403) {
      const body = await res.text()
      throw new Error(
        `楽天APIが403を返した。現在のグローバルIPが楽天ウェブサービスに登録されていない可能性が高い。\n` +
          `  curl.exe ifconfig.me で現在のIPを確認し、\n` +
          `  https://webservice.rakuten.co.jp/app/list の「許可されたIPアドレス」を更新する\n` +
          `  応答: ${body.slice(0, 200)}`,
      )
    }
    // 429（レート制限）と5xx（楽天側の一時障害）は待てば回復する。
    // 748件も流すと503は普通に混ざるので、ここで止めると毎回完走しない。
    if (res.status === 429 || res.status >= 500) {
      await sleep(3000 * (attempt + 1))
      continue
    }
    const body = await res.text()
    // キーワード起因の400は、その商品を飛ばせば済む。全748件の処理を止めない。
    if (res.status === 400 && body.includes('keyword')) return null
    throw new Error(`楽天API エラー ${res.status}: ${body.slice(0, 200)}`)
  }
  // リトライしきっても回復しない場合、その商品だけ諦めて次へ進む
  console.warn(`  ! 応答が安定せずスキップ: ${JSON.stringify(query)}`)
  return null
}

export function pickImage(item: RakutenItem): string | undefined {
  const first = item.mediumImageUrls?.[0]
  const url = typeof first === 'string' ? first : first?.imageUrl
  // サムネイル指定のまま保存すると一覧でぼやける
  return url?.replace(/\?_ex=\d+x\d+$/, '?_ex=400x400')
}

// ─── Supabase ────────────────────────────────────────────────────

type ProductUpsert = {
  name: string
  product_name?: string | null
  brand?: string | null
  category?: string | null
  asin?: string | null
  image?: string | null
  description?: string | null
}

type ShopLinkUpsert = {
  product_id: string
  shop: string
  country: string
  affiliate_url?: string | null
  official_url?: string | null
  price?: number | null
  currency?: string | null
  in_stock?: boolean | null
  /** 楽天のレビュー件数。予測変換から不人気商品を外す基準に使う */
  review_count?: number | null
  last_updated: string
}

/** dry-run では Supabase に接続しない（service_role キーが無くても照合結果を確認できる） */
type Db = ReturnType<typeof createAdminClient> | null

export function createAdminClient() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const missing = [
    !url && 'EXPO_PUBLIC_SUPABASE_URL',
    !key && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean)
  if (!url || !key) {
    throw new Error(
      `.env に ${missing.join(' と ')} を設定する\n` +
        '  service_role キー: Supabase ダッシュボード > Project Settings > API Keys\n' +
        '  （anon キーではない。007_products.sql の RLS で書き込みは service_role のみ）',
    )
  }
  // RLS は書き込みを service_role のみに許可している（007_products.sql）
  return createClient(url, key, { auth: { persistSession: false } })
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ─── 本体 ────────────────────────────────────────────────────────

type Preset = NameSuggestion & { category?: string }

function collectPresets(): Preset[] {
  // 同じ商品が複数の配列に入っている場合がある。name が unique なので先勝ちで潰す
  const byName = new Map<string, Preset>()
  for (const p of ALL_PRODUCT_PRESETS as Preset[]) {
    const name = p.name?.trim()
    if (!name) continue
    if (!byName.has(name)) byName.set(name, { ...p, name })
  }
  let list = [...byName.values()]
  if (ONLY) list = list.filter((p) => p.name.toLowerCase().includes(ONLY))
  if (LIMIT > 0) list = list.slice(0, LIMIT)
  return list
}

async function upsertPresets(db: Db, presets: Preset[]): Promise<Map<string, string>> {
  const rows: ProductUpsert[] = presets.map((p) => ({
    name: p.name,
    product_name: productIdentity(p.name, p.brand).productName,
    brand: p.brand ?? null,
    category: p.category ?? null,
    asin: p.asin ?? null,
  }))

  // 楽天補完と shop_links に product_id が要る
  const idByName = new Map<string, string>()
  if (!db) return idByName

  // id は upsert の戻り値から受け取る。名前で引き直すと `.in('name', …)` に
  // `MacBook Pro 14" M4 Pro` のような引用符入りの名前が混ざり、PostgREST の
  // リスト解析が壊れてその塊のぶんだけ id が欠ける。欠けた商品は下の
  // 書き込みが黙って飛ばされ、ログ上は成功しているように見える。
  for (const part of chunk(rows, 500)) {
    const { data, error } = await db
      .from('products')
      .upsert(part, { onConflict: 'name' })
      .select('id, name')
    if (error) throw new Error(`products の upsert に失敗: ${error.message}`)
    for (const row of data ?? []) idByName.set(row.name, row.id)
  }

  const missing = presets.filter((p) => !idByName.has(p.name))
  if (missing.length > 0) {
    throw new Error(
      `products の id を ${missing.length} 件取得できなかった。` +
        `このまま進むと該当商品のリンクが書き込まれないまま成功と表示される。\n` +
        `  例: ${missing.slice(0, 5).map((p) => p.name).join(' / ')}`,
    )
  }
  return idByName
}

async function upsertPresetLinks(
  db: Db,
  presets: Preset[],
  idByName: Map<string, string>,
): Promise<number> {
  const now = new Date().toISOString()
  const rows: ShopLinkUpsert[] = []
  for (const p of presets) {
    const productId = idByName.get(p.name)
    if (!productId) continue
    const url = p.affiliateUrl ?? p.officialUrl
    if (!url) continue
    const { shop, country } = inferShop(url)
    rows.push({
      product_id: productId,
      shop,
      country,
      affiliate_url: p.affiliateUrl ?? null,
      official_url: p.officialUrl ?? null,
      last_updated: now,
    })
  }
  if (rows.length > 0 && db) {
    for (const part of chunk(rows, 500)) {
      const { error } = await db
        .from('shop_links')
        .upsert(part, { onConflict: 'product_id,shop' })
      if (error) throw new Error(`shop_links の upsert に失敗: ${error.message}`)
    }
  }
  return rows.length
}

async function enrichFromRakuten(
  db: Db,
  presets: Preset[],
  idByName: Map<string, string>,
): Promise<void> {
  const missing = [
    !process.env.RAKUTEN_APP_ID && 'RAKUTEN_APP_ID',
    !process.env.RAKUTEN_ACCESS_KEY && 'RAKUTEN_ACCESS_KEY',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new Error(
      `.env に ${missing.join(' と ')} を設定する\n` +
        '  https://webservice.rakuten.co.jp/app/list のアプリ詳細に両方載っている\n' +
        '  （2026年2月の刷新でアクセスキーが必須になった。IDだけでは400が返る）\n' +
        '  まだ取得していないなら --skip-rakuten を付けて実行する',
    )
  }
  if (!process.env.RAKUTEN_AFFILIATE_ID) {
    console.warn('! RAKUTEN_AFFILIATE_ID 未設定。通常の商品ページURLで登録する（報酬は発生しない）')
  }

  let targets = presets.filter((p) => !isGenericName(p.name))
  const skipped = presets.length - targets.length
  if (skipped > 0) console.log(`  カテゴリ名の行 ${skipped} 件は検索対象外`)

  // 途中で落ちたときに全件やり直さないための再開モード。
  // 価格を更新したいときはフラグを外して全件回す。
  if (RESUME && db) {
    const done = new Set<string>()
    const ids = [...idByName.values()]
    for (const part of chunk(ids, 200)) {
      const { data } = await db
        .from('shop_links')
        .select('product_id')
        .eq('shop', 'rakuten_jp')
        .in('product_id', part)
      for (const row of data ?? []) done.add(row.product_id)
    }
    const before = targets.length
    targets = targets.filter((p) => {
      const id = idByName.get(p.name)
      return !id || !done.has(id)
    })
    console.log(`  --resume: 取得済み ${before - targets.length} 件をスキップ`)
  }

  let matched = 0
  let missed = 0
  const now = new Date().toISOString()

  for (const [i, preset] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${preset.name}`
    const keyword = buildKeyword(preset)
    if (keyword.length < 2) {
      missed++
      console.log(`${label} → 検索語を作れずスキップ`)
      continue
    }

    let items = await searchRakuten({ keyword })
    if (items === null) {
      missed++
      console.log(`${label} → 楽天がキーワードを受け付けずスキップ（"${keyword}"）`)
      await sleep(REQUEST_INTERVAL_MS)
      continue
    }

    // 全語AND検索なので「LG UltraGear 27GN850」のような表記揺れで0件になる。
    // 型番だけで引き直す。誤ヒットは下の matchScore が弾く。
    const model = tokenize(stripDescriptor(preset.name)).find(isModelNumber)
    if (items.length === 0 && model) {
      await sleep(REQUEST_INTERVAL_MS)
      items = (await searchRakuten({ keyword: model })) ?? []
    }

    // 新品を優先し、見つからないときだけ中古を許容する。
    // 型落ちモデルは楽天に中古しか無いことが多く、除外すると購入導線が消える。
    const pool = dropCheapOutliers(
      items.filter((item) => !hasWord(item.itemName, preset.name, PARTS_WORDS)),
    )

    // 一致率が同じならレビュー数が多いものを採る。本体はアクセサリや
    // 業務用セットより桁違いにレビューが付く。価格を基準にすると
    // 候補群の構成しだいで安物にも高額セットにも振れて安定しない。
    const rank = (list: RakutenItem[]) =>
      list
        .map((item) => ({ item, score: matchScore(preset.name, item.itemName) }))
        .sort(
          (a, b) =>
            b.score - a.score || (b.item.reviewCount ?? 0) - (a.item.reviewCount ?? 0),
        )[0]
    const newOnly = pool.filter((item) => !hasWord(item.itemName, preset.name, USED_WORDS))
    const fromNew = rank(newOnly)
    const best = fromNew && fromNew.score >= MATCH_THRESHOLD ? fromNew : rank(pool)

    if (!best || best.score < MATCH_THRESHOLD) {
      missed++
      console.log(`${label} → 該当なし（最高一致率 ${best ? best.score.toFixed(2) : '-'}）`)
      await sleep(REQUEST_INTERVAL_MS)
      continue
    }

    const productId = idByName.get(preset.name)
    if (db && !productId) {
      // 起きないはずだが、起きたときに「登録した」と誤報するのが一番まずい
      missed++
      console.warn(`${label} → 商品IDが引けず書き込みをスキップ`)
      await sleep(REQUEST_INTERVAL_MS)
      continue
    }

    matched++
    const item = best.item
    // 中古は在庫1点で価格も本体新品と乖離する。リンクだけ使い、価格は保存しない。
    const isUsed = hasWord(item.itemName, preset.name, USED_WORDS)
    // dry-run は精度確認が目的なので、実際に採用した商品名まで見せる
    const detail = DRY_RUN ? `\n        ${item.itemName.slice(0, 60)}` : ''
    const priceLabel = isUsed ? '中古（価格なし）' : `¥${item.itemPrice.toLocaleString()}`
    console.log(`${label} → ${priceLabel} (一致率 ${best.score.toFixed(2)})${detail}`)

    if (db && productId) {
      // 画像・説明はプリセットに無く楽天由来のみ。既に入っていても最新で上書きする
      const { error: pErr } = await db
        .from('products')
        .update({
          image: pickImage(item) ?? null,
          description: item.itemCaption?.slice(0, DESCRIPTION_MAX) ?? null,
        })
        .eq('id', productId)
      if (pErr) throw new Error(`products の更新に失敗 (${preset.name}): ${pErr.message}`)

      const { error: lErr } = await db.from('shop_links').upsert(
        {
          product_id: productId,
          shop: 'rakuten_jp',
          country: 'JP',
          affiliate_url: item.affiliateUrl ?? null,
          official_url: item.itemUrl,
          price: isUsed ? null : item.itemPrice,
          currency: isUsed ? null : 'JPY',
          review_count: item.reviewCount ?? 0,
          in_stock: item.availability === 1,
          last_updated: now,
        } satisfies ShopLinkUpsert,
        { onConflict: 'product_id,shop' },
      )
      if (lErr) throw new Error(`shop_links の upsert に失敗 (${preset.name}): ${lErr.message}`)
    }

    await sleep(REQUEST_INTERVAL_MS)
  }

  console.log(`\n楽天: ${matched} 件を登録 / ${missed} 件は該当なし`)
}

async function main(): Promise<void> {
  loadEnv()

  const presets = collectPresets()
  console.log(`対象 ${presets.length} 件${DRY_RUN ? '（dry-run: 書き込まない）' : ''}`)
  if (presets.length === 0) return

  const db: Db = DRY_RUN ? null : createAdminClient()

  console.log('\nStep1: プリセットを products へ投入')
  const idByName = await upsertPresets(db, presets)
  const linkCount = await upsertPresetLinks(db, presets, idByName)
  console.log(`  products ${presets.length} 件 / プリセット由来リンク ${linkCount} 件`)

  if (SKIP_RAKUTEN) {
    console.log('\n--skip-rakuten のため楽天APIは呼ばない')
    return
  }

  const minutes = Math.ceil((presets.length * REQUEST_INTERVAL_MS) / 60000)
  console.log(`\nStep2: 楽天APIで補完（1件1秒ペース。目安 ${minutes} 分）`)
  await enrichFromRakuten(db, presets, idByName)
}

// 他のスクリプト（importRakutenGenres.ts）から関数を import しても取り込みが走らないように
if (require.main === module) {
  main().catch((e: unknown) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`)
  // process.exit() だと Windows で libuv のハンドルが閉じきる前に落ちて
  // Assertion failed が出る。終了コードだけ立てて自然に終わらせる。
    process.exitCode = 1
  })
}
