/**
 * キーボード商品の接続方式を判定して JSON に書き出す（手元PCから実行する）
 *
 *   npx tsx scripts/researchKeyboardPorts.ts                  # 商品名・説明だけで判定（ページ取得なし）
 *   npx tsx scripts/researchKeyboardPorts.ts --fetch          # 名前で決まらないものだけ商品ページを見る
 *   npx tsx scripts/researchKeyboardPorts.ts --fetch --limit 50
 *   npx tsx scripts/researchKeyboardPorts.ts --id <uuid>,<uuid>
 *   npx tsx scripts/researchKeyboardPorts.ts --sample 30      # 判定結果を根拠つきで抜き出して確認する
 *
 * 出力は .codex-backups/keyboard-port-research-<stamp>.json。
 * これを scripts/updateKeyboardProductPorts.ts が読んで products.ports を更新し、
 * アプリ側は予測変換で商品を選んだ時点で ports から接続方式（有線 / 2.4GHz / Bluetooth）を復元する。
 *
 * 楽天由来の商品名は表記ゆれが激しいので、判定できなかったものは「書かない」。
 * 誤った接続方式を入れると配線図に存在しない線が出るため、空欄のほうが害が小さい。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'

type Product = {
  id: string
  name: string
  description: string | null
  subcategory: string | null
  shop_links: Array<{ official_url: string | null; affiliate_url: string | null }>
}

export type KeyboardModes = { wired: boolean; dongle: boolean; bluetooth: boolean }

export type KeyboardDecision = {
  id: string
  name: string
  modes: KeyboardModes
  /** 有線モードを持つときの本体側コネクタ。無線専用なら null */
  wiredConnector: 'USB_C' | 'USB_A' | null
  /** キーボードに付いている USB パススルーハブの口数（0 = 無し） */
  hubUsbA: number
  /**
   * name = 商品名・説明から判定 / page = 商品ページの接続欄から判定 /
   * page-full = ページ全文から判定（関連商品の記述を拾っている可能性がある）
   */
  origin: 'name' | 'page' | 'page-full'
  sourceUrl: string | null
  evidence: string[]
}

type Unresolved = { id: string; name: string; reason: string; sourceUrl: string | null }

export type KeyboardResearch = {
  generatedAt: string
  fetched: boolean
  decided: KeyboardDecision[]
  unresolved: Unresolved[]
}

// 判定に使う語。楽天の商品名は「無線」「ワイヤレス」としか書かないものが多いため、
// Bluetooth と 2.4GHz を区別できる語が出るまでは未判定として扱う。
const PATTERNS = {
  tri: /トリプルモード|トライモード|3\s*(?:way|ウェイ|モード)|3\s*in\s*1|三[つ]?のモード/gi,
  bluetooth: /bluetooth|ブルートゥース|\bBT\s*[0-9]\.[0-9]|マルチペアリング/gi,
  dongle: /2\.4\s*G(?:hz)?|レシーバ|ドングル|dongle|lightspeed|slipstream|unifying|logi\s*bolt/gi,
  wired: /有線|wired|USB\s*ケーブル|ケーブル接続|着脱式\s*(?:USB)?\s*ケーブル/gi,
  wireless: /無線|ワイヤレス|wireless|コードレス/gi,
  // Type-C 表記は充電端子や別モデルの仕様表を指していることが多いので、
  // 有線・接続の語と隣り合っているときだけ有線コネクタの根拠に使う
  wiredUsbC: /(?:有線|wired|接続)[^。｜|]{0,24}(?:type\s*[-‐ー]?\s*c|usb\s*[-‐ー]?\s*c|タイプ\s*c)|(?:type\s*[-‐ー]?\s*c|usb\s*[-‐ー]?\s*c|タイプ\s*c)[^。｜|]{0,24}(?:有線|wired|接続)/gi,
  usba: /usb\s*[-‐ー]?\s*a\b|タイプ\s*a/gi,
  hub: /(\d)\s*ポート\s*(?:USB\s*[0-9.]*)?\s*(?:HUB|ハブ)|USB\s*(?:[0-9.]+)?\s*(?:HUB|ハブ)\s*付/gi,
  // キーボードではない付属品。カテゴリ判定が甘い商品が Keyboard に混ざっている
  accessory: /キーボード\s*(?:ケーブル|カバー|ルーフ|ケース|スタンド|クリーナー|ブラシ|マット)|キーキャップ(?:セット)?|パームレスト|リストレスト|スタビライザー|潤滑|ルブ|交換用スイッチ|スイッチ\s*(?:単体|\d+個)|バッテリー\s*の?\s*交換|交換用\s*バッテリー|互換\s*バッテリー/gi,
  // 「有線版／無線版」のように複数バリエーションを1商品として売っている出品
  variantListing: /選べる|お選び|各種|バリエーション|どちらか|2種類|２種類/gi,
}

// 「Bluetooth不要」「無線非対応」を根拠として拾うと、逆の接続方式が入ってしまう
const NEGATION = /(?:bluetooth|ブルートゥース|無線|ワイヤレス|有線|2\.4\s*G(?:hz)?)\s*(?:は|には)?\s*(?:不要|不可|非対応|対応していません|使用できません|ではありません)/gi

function stripNegations(text: string): string {
  return text.replace(NEGATION, ' ')
}

function excerpts(text: string, pattern: RegExp, label: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    found.push(`${label}: ${text.slice(Math.max(0, index - 14), index + match[0].length + 14).trim()}`)
    if (found.length >= 2) break
  }
  return found
}

/** キーボード本体ではない付属品・交換部品か（カテゴリ判定が甘い商品が Keyboard に混ざっている） */
export function isAccessoryName(name: string): boolean {
  return excerpts(name, PATTERNS.accessory, 'accessory').length > 0
}

type Classification =
  | { ok: true; modes: KeyboardModes; wiredConnector: 'USB_C' | 'USB_A' | null; hubUsbA: number; evidence: string[] }
  | { ok: false; reason: string }

function hubCount(text: string): { count: number; evidence: string[] } {
  for (const match of text.matchAll(PATTERNS.hub)) {
    const explicit = Number(match[1])
    return {
      count: Number.isInteger(explicit) && explicit > 0 && explicit <= 4 ? explicit : 1,
      evidence: [`hub: ${match[0].trim()}`],
    }
  }
  return { count: 0, evidence: [] }
}

export type ConnectionModes =
  | { ok: true; modes: KeyboardModes; tri: boolean; evidence: string[] }
  | { ok: false; reason: string }

/**
 * 有線 / 2.4GHzレシーバー / Bluetooth のどれに対応しているかだけを判定する。
 * マウス・コントローラー等も同じ語で書かれているので、他カテゴリからも使う。
 */
export function connectionModes(raw: string): ConnectionModes {
  const text = stripNegations(raw)
  const tri = excerpts(text, PATTERNS.tri, 'tri')
  const bluetooth = excerpts(text, PATTERNS.bluetooth, 'bt')
  const dongle = excerpts(text, PATTERNS.dongle, '2.4G')
  const wired = excerpts(text, PATTERNS.wired, 'wired')
  const wireless = excerpts(text, PATTERNS.wireless, 'wireless')
  const variant = excerpts(text, PATTERNS.variantListing, 'variant')

  // 有線と無線を両方うたい、かつ「選べる」系の語がある出品は別商品の抱き合わせ。
  // どちらの構成を登録すべきか決められないので触らない
  if (wired.length > 0 && wireless.length > 0 && tri.length === 0 && variant.length > 0) {
    return { ok: false, reason: 'variant-listing' }
  }

  const modes: KeyboardModes = tri.length > 0
    ? { wired: true, dongle: true, bluetooth: true }
    : { wired: wired.length > 0, dongle: dongle.length > 0, bluetooth: bluetooth.length > 0 }

  // 「無線」としか書いていない → Bluetooth か 2.4GHz か決まらない
  if (!modes.bluetooth && !modes.dongle && wireless.length > 0) {
    return { ok: false, reason: 'wireless-kind-unknown' }
  }
  if (!modes.wired && !modes.bluetooth && !modes.dongle) {
    return { ok: false, reason: 'no-signal' }
  }
  return { ok: true, modes, tri: tri.length > 0, evidence: [...tri, ...bluetooth, ...dongle, ...wired] }
}

function classify(raw: string): Classification {
  const text = stripNegations(raw)
  const resolved = connectionModes(raw)
  if (!resolved.ok) return resolved
  const { modes } = resolved
  const evidence = [...resolved.evidence]
  let wiredConnector: 'USB_C' | 'USB_A' | null = null
  if (modes.wired) {
    const usbc = excerpts(text, PATTERNS.wiredUsbC, 'usb-c')
    const usba = excerpts(text, PATTERNS.usba, 'usb-a')
    // 根拠が無いときは USB-A に倒す。キーボード側が Type-C でも
    // 付属ケーブルの相手側は USB-A であることが多く、外したときの実害が小さい
    wiredConnector = usbc.length > 0 ? 'USB_C' : 'USB_A'
    evidence.push(...(usbc.length > 0 ? usbc : usba))
  }

  const hub = hubCount(text)
  evidence.push(...hub.evidence)
  return { ok: true, modes, wiredConnector, hubUsbA: hub.count, evidence }
}

/** ページ由来の判定は誤検出しやすいので、実在する組み合わせだけ受け入れる */
function isPlausible(modes: KeyboardModes, text: string): boolean {
  if (modes.wired && modes.dongle && modes.bluetooth) return excerpts(text, PATTERNS.tri, 'tri').length > 0
  return modes.wired || modes.dongle || modes.bluetooth
}

function modeCount(modes: KeyboardModes): number {
  return Number(modes.wired) + Number(modes.dongle) + Number(modes.bluetooth)
}

/**
 * 商品ページから接続方式を決める。
 * まず「接続」まわりの記述だけを見て、それで決まらないときだけページ全文にかける。
 * 全文には関連商品やレビューが混ざるので、方式が1つに絞れた場合しか採用しない。
 */
function classifyFromPage(name: string, pageText: string): { result: Classification; scope: 'page' | 'page-full' } {
  const context = connectionContext(pageText)
  const scoped = classify(`${name} ${context}`)
  if (scoped.ok && isPlausible(scoped.modes, context)) return { result: scoped, scope: 'page' }

  const whole = classify(`${name} ${pageText}`)
  if (!whole.ok) return { result: whole, scope: 'page-full' }
  if (modeCount(whole.modes) !== 1) return { result: { ok: false, reason: 'page-conflict' }, scope: 'page-full' }
  return { result: whole, scope: 'page-full' }
}

function productUrl(product: Product): string | null {
  for (const link of product.shop_links) {
    const raw = link.official_url ?? link.affiliate_url
    if (!raw) continue
    try {
      const url = new URL(raw)
      const target = url.searchParams.get('pc')
      return target ? decodeURIComponent(target) : raw
    } catch {}
  }
  return null
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

function visibleText(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; MyDeskKeyboardSpecAudit/1.0)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? ''
  const prefix = new TextDecoder('ascii').decode(bytes.slice(0, 4096))
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]
    ?? prefix.match(/charset=["']?([^"'\s/>]+)/i)?.[1]
    ?? 'utf-8'
  const encoding = /shift[_-]?jis|sjis|windows-31j/i.test(charset)
    ? 'shift_jis'
    : /euc[_-]?jp/i.test(charset) ? 'euc-jp' : 'utf-8'
  return visibleText(new TextDecoder(encoding).decode(bytes))
}

/** ページ全文を判定にかけると関連商品やレビューを拾うので、接続の話題の周辺だけ切り出す */
function connectionContext(text: string): string {
  const marker = /接続方式|接続方法|接続タイプ|接続形式|インターフェ[イー]ス|通信方式|ワイヤレス方式|接続/gi
  const ranges: Array<[number, number]> = []
  for (const match of text.matchAll(marker)) {
    const start = Math.max(0, (match.index ?? 0) - 120)
    const end = Math.min(text.length, (match.index ?? 0) + 200)
    const previous = ranges.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
    if (ranges.length >= 12) break
  }
  return ranges.map(([start, end]) => text.slice(start, end)).join(' … ')
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function connectionShape(decision: KeyboardDecision): string {
  return [
    decision.modes.wired ? `有線(${decision.wiredConnector === 'USB_C' ? 'C' : 'A'})` : null,
    decision.modes.dongle ? '2.4GHz' : null,
    decision.modes.bluetooth ? 'BT' : null,
  ].filter(Boolean).join('+')
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const shouldFetch = process.argv.includes('--fetch')
  const limit = Number(argValue('--limit') ?? '0')
  const ids = argValue('--id')?.split(',').filter(Boolean)
  const sample = Number(argValue('--sample') ?? '0')

  // Supabase の max-rows は 1000。終端を広げても切れるのでページングする
  const products: Product[] = []
  for (let from = 0; ; from += 1000) {
    let query = db
      .from('products')
      .select('id,name,description,subcategory,shop_links(official_url,affiliate_url)')
      .eq('category', 'Keyboard')
      .order('name')
      .range(from, from + 999)
    if (ids?.length) query = query.in('id', ids)
    const { data, error } = await query
    if (error) throw new Error(`キーボード商品の取得に失敗: ${error.message}`)
    products.push(...((data ?? []) as Product[]))
    if (!data || data.length < 1000) break
  }
  const decided: KeyboardDecision[] = []
  const unresolved: Unresolved[] = []
  const needsPage: Array<{ product: Product; reason: string }> = []

  for (const product of products) {
    const text = `${product.name} ${product.description ?? ''}`
    if (isAccessoryName(text)) {
      unresolved.push({ id: product.id, name: product.name, reason: 'accessory', sourceUrl: productUrl(product) })
      continue
    }
    const result = classify(text)
    if (result.ok) {
      decided.push({
        id: product.id,
        name: product.name,
        modes: result.modes,
        wiredConnector: result.wiredConnector,
        hubUsbA: result.hubUsbA,
        origin: 'name',
        sourceUrl: null,
        evidence: result.evidence,
      })
    } else {
      needsPage.push({ product, reason: result.reason })
    }
  }

  const targets = limit > 0 ? needsPage.slice(0, limit) : needsPage
  if (shouldFetch) {
    console.log(`商品ページを取得: ${targets.length}件`)
    let done = 0
    for (let index = 0; index < targets.length; index += 5) {
      await Promise.all(targets.slice(index, index + 5).map(async ({ product, reason }) => {
        const url = productUrl(product)
        if (!url) {
          unresolved.push({ id: product.id, name: product.name, reason: `${reason}/no-url`, sourceUrl: null })
          return
        }
        try {
          const { result, scope } = classifyFromPage(product.name, await fetchText(url))
          if (result.ok) {
            decided.push({
              id: product.id,
              name: product.name,
              modes: result.modes,
              wiredConnector: result.wiredConnector,
              hubUsbA: result.hubUsbA,
              origin: scope,
              sourceUrl: url,
              evidence: result.evidence,
            })
          } else {
            unresolved.push({
              id: product.id,
              name: product.name,
              reason: `page/${result.reason}`,
              sourceUrl: url,
            })
          }
        } catch (fetchError) {
          unresolved.push({
            id: product.id,
            name: product.name,
            reason: `fetch-failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            sourceUrl: url,
          })
        }
      }))
      done += Math.min(5, targets.length - index)
      if (done % 50 === 0 || done === targets.length) console.log(`  ${done}/${targets.length}`)
    }
    for (const { product, reason } of needsPage.slice(targets.length)) {
      unresolved.push({ id: product.id, name: product.name, reason, sourceUrl: productUrl(product) })
    }
  } else {
    for (const { product, reason } of needsPage) {
      unresolved.push({ id: product.id, name: product.name, reason, sourceUrl: productUrl(product) })
    }
  }

  const research: KeyboardResearch = {
    generatedAt: new Date().toISOString(),
    fetched: shouldFetch,
    decided,
    unresolved,
  }
  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const outPath = resolve(backupDir, `keyboard-port-research-${research.generatedAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(research, null, 2))

  const byShape: Record<string, number> = {}
  for (const decision of decided) {
    const key = connectionShape(decision)
    byShape[key] = (byShape[key] ?? 0) + 1
  }
  const byReason: Record<string, number> = {}
  for (const item of unresolved) {
    const key = item.reason.split(':')[0]
    byReason[key] = (byReason[key] ?? 0) + 1
  }

  const byOrigin: Record<string, number> = {}
  for (const decision of decided) byOrigin[decision.origin] = (byOrigin[decision.origin] ?? 0) + 1

  console.log(`\n対象 ${products.length}件 → 判定 ${decided.length}件 / 未判定 ${unresolved.length}件`)
  console.log('判定の出どころ:', byOrigin)
  console.log('接続方式の内訳:', byShape)
  console.log('未判定の理由:', byReason)
  console.log(`ハブ付きと判定: ${decided.filter((decision) => decision.hubUsbA > 0).length}件`)
  console.log(`出力: ${outPath}`)

  if (sample > 0) {
    console.log('\n--- 判定サンプル ---')
    for (const decision of [...decided].sort(() => Math.random() - 0.5).slice(0, sample)) {
      console.log(`[${connectionShape(decision)}] (${decision.origin}) ${decision.name.slice(0, 70)}`)
      console.log(`    ${decision.evidence.slice(0, 3).join(' | ')}`)
    }
  }
}

// updateKeyboardProductPorts.ts が型とヘルパーを import するので、
// 直接実行されたときだけ調査を走らせる
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/researchKeyboardPorts.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
