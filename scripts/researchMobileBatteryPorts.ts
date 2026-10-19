import { createAdminClient, loadEnv } from './importRakuten'

const ACTUAL = /モバイルバッテリー|power\s*(?:bank|core)|magnetic battery|smartcoby|battery pack|AUKEY Basix|cheero Power Plus|RAVPower/i
const REPLACEMENT = /互換|交換用?|内[蔵臓]|純正バッテリー|ノート(?:PC|パソコン)|ラップトップ|タブレット用|スマホ用バッテリー|電池パック|battery\s+(?:for|replacement)|対応機種|CMOS|PSE認証済.*(?:PC|パソコン)/i
const CHARGER_ONLY = /バッテリーチャージャー|ACアダプタ|電源アダプタ|USBケーブル|充電ケーブル|充電スタンド/i
const KNOWN_ACTUAL_IDS = new Set([
  'de93ba4b-53f5-4c88-bb57-c32e063e44e4',
  '841fa508-d376-457f-899a-f72ab2fe4c69',
  '90c0d3aa-ed4f-407c-a9ec-2e685a707d12',
  'da55ef39-a622-47be-bdb2-ff213ece8289',
  'f2ed6681-2b99-4ff0-bbf9-0752ed396714',
  '027157e3-83fa-4f3d-afc9-2d1584df1ba0',
  'abf7c561-2863-4ceb-8faf-fdc1b7bbe0e0',
])
const EVIDENCE = /(?:USB[－ー\s-]?[CA]|USB\s*Type[－ー\s-]?C|Type[－ー\s-]?[CA]|Lightning|ライトニング|micro\s*USB|ワイヤレス|Qi2?|入力|出力|ポート|内蔵ケーブル|一体型ケーブル|ケーブル内蔵)/gi

function isActual(name: string): boolean {
  return ACTUAL.test(name) && !REPLACEMENT.test(name) && !CHARGER_ONLY.test(name)
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

function contexts(text: string): string[] {
  const ranges: Array<[number, number]> = []
  for (const match of text.matchAll(EVIDENCE)) {
    const start = Math.max(0, (match.index ?? 0) - 130)
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 220)
    const previous = ranges.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
    if (ranges.length >= 8) break
  }
  return ranges.map(([start, end]) => text.slice(start, end))
}

function productUrl(links: Array<{ affiliate_url: string | null; official_url: string | null }>): string | null {
  for (const link of links) {
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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const bytes = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? ''
  const prefix = new TextDecoder('ascii').decode(bytes.slice(0, 4096))
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]
    ?? prefix.match(/charset=["']?([^"'\s/>]+)/i)?.[1]
    ?? 'utf-8'
  const encoding = /shift[_-]?jis|sjis|windows-31j/i.test(charset)
    ? 'shift_jis'
    : /euc[_-]?jp/i.test(charset)
      ? 'euc-jp'
      : 'utf-8'
  return visibleText(new TextDecoder(encoding).decode(bytes))
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const { data, error } = await db
    .from('products')
    .select('id,name,brand,ports,shop_links(official_url,affiliate_url)')
    .eq('category', 'MobileBattery')
    .order('brand')
    .order('name')
  if (error) throw new Error(`商品取得に失敗: ${error.message}`)
  const idIndex = process.argv.indexOf('--id')
  const requestedIds = idIndex >= 0 ? new Set((process.argv[idIndex + 1] ?? '').split(',').filter(Boolean)) : null
  const products = (data ?? []).filter((product) =>
    (isActual(product.name) || KNOWN_ACTUAL_IDS.has(product.id))
    && !Array.isArray(product.ports)
    && (!requestedIds || requestedIds.has(product.id)))
  console.log(`未登録の本体候補: ${products.length}件`)
  if (process.argv.includes('--list')) {
    for (const product of products) console.log(`${product.id}\t${productUrl(product.shop_links) ?? '-'}\t${product.name}`)
    return
  }
  for (const product of products) {
    const url = productUrl(product.shop_links)
    console.log(`\n### ${product.id}\t${product.name}\nURL: ${url ?? '-'}`)
    if (!url) continue
    try {
      const text = await fetchText(url)
      const evidence = contexts(text)
      console.log(evidence.length ? evidence.join('\n---\n') : '端子記述を抽出できませんでした')
    } catch (fetchError) {
      console.log(`取得失敗: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
