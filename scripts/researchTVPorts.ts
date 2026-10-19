import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'

type Product = {
  id: string
  name: string
  brand: string | null
  shop_links: Array<{ official_url: string | null; affiliate_url: string | null }>
}

type Match = { count: number; evidence: string }

const ACCESSORY = /リモコン|リモートコントローラ|壁掛け金具|保護パネル|テレビ台|アンテナ|ケーブル|チューナー単体/i

function itemUrl(product: Product): string | undefined {
  const raw = product.shop_links.map((link) => link.official_url ?? link.affiliate_url).find(Boolean)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    const target = url.searchParams.get('pc')
    return target ? new URL(target).toString() : url.toString()
  } catch {
    return undefined
  }
}

function textFromHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&times;|&#215;|&Cross;/gi, '×')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/\s+/g, ' ')
}

function matches(text: string, patterns: RegExp[]): Match[] {
  const result: Match[] = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(match[1])
      if (!Number.isInteger(count) || count < 0 || count > 12) continue
      const index = match.index ?? 0
      result.push({ count, evidence: text.slice(Math.max(0, index - 70), index + match[0].length + 70) })
    }
  }
  return result
}

function uniqueCount(values: Match[]): number | undefined {
  const counts = [...new Set(values.map((value) => value.count))]
  return counts.length === 1 ? counts[0] : undefined
}

async function research(product: Product) {
  if (ACCESSORY.test(product.name)) return { id: product.id, name: product.name, classification: 'accessory', evidence: [] }
  const sourceUrl = itemUrl(product)
  if (!sourceUrl) return { id: product.id, name: product.name, classification: 'tv', skipped: 'no-source-url', evidence: [] }
  try {
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyDeskTVSpecAudit/1.0)' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? ''
    const charset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase()
    const bytes = await response.arrayBuffer()
    let html: string
    try {
      const ascii = new TextDecoder('windows-1252').decode(bytes.slice(0, 4096))
      const declared = charset ?? ascii.match(/charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1]?.toLowerCase()
      const encoding = declared?.includes('euc') ? 'euc-jp'
        : declared === 'shift_jis' || declared === 'shift-jis' || declared === 'sjis' ? 'shift_jis'
          : 'utf-8'
      html = new TextDecoder(encoding).decode(bytes)
    } catch {
      html = new TextDecoder('utf-8').decode(bytes)
    }
    const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim()
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
    const text = textFromHtml(html)
    const hdmiMatches = matches(text, [
      /HDMI(?:入力)?端子(?:数)?\s*[：:]?\s*(\d+)\s*(?:個|系統|端子)?/gi,
      /HDMI(?:入力)?\s*[×xX]\s*(\d+)/gi,
      /HDMI\s*入力\s*(\d+)\s*系統/gi,
      /HDMI入力端子を?(\d+)\s*系統/gi,
    ])
    const usbMatches = matches(text, [
      /USB(?:入力)?端子(?:数)?\s*[：:]?\s*(\d+)\s*(?:個|系統|端子)?/gi,
      /USB\s*[×xX]\s*(\d+)/gi,
      /USB\s*(\d+)\s*系統/gi,
    ])
    const ethernet = /LAN端子|LAN\s*[：:]|Ethernet|RJ-?45/i.test(text)
    const audioOut = /ヘッドホン(?:出力)?端子|イヤホン(?:出力)?端子|3[.]5\s*mm.*(?:出力|ジャック)|音声出力端子/i.test(text)
    return {
      id: product.id,
      name: product.name,
      classification: 'tv',
      sourceUrl,
      pageTitle,
      ogTitle,
      hdmi: uniqueCount(hdmiMatches),
      usb: uniqueCount(usbMatches),
      ethernet,
      audioOut,
      conflictingHdmi: [...new Set(hdmiMatches.map((match) => match.count))],
      conflictingUsb: [...new Set(usbMatches.map((match) => match.count))],
      evidence: [...hdmiMatches, ...usbMatches].slice(0, 12).map((match) => match.evidence),
    }
  } catch (error) {
    return {
      id: product.id,
      name: product.name,
      classification: 'tv',
      sourceUrl,
      evidence: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const { data, error } = await db
    .from('products')
    .select('id,name,brand,shop_links(official_url,affiliate_url)')
    .eq('category', 'TV')
    .order('name')
  if (error) throw new Error(`テレビ商品の取得に失敗: ${error.message}`)
  const products = (data ?? []) as Product[]
  const researched: Awaited<ReturnType<typeof research>>[] = []
  for (let index = 0; index < products.length; index += 5) {
    researched.push(...await Promise.all(products.slice(index, index + 5).map(research)))
  }
  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputPath = resolve(backupDir, `tv-port-research-${stamp}.json`)
  writeFileSync(outputPath, JSON.stringify(researched, null, 2))
  console.log(JSON.stringify({
    total: researched.length,
    accessories: researched.filter((item) => item.classification === 'accessory').length,
    tvs: researched.filter((item) => item.classification === 'tv').length,
    exactHdmi: researched.filter((item) => item.hdmi !== undefined).length,
    exactUsb: researched.filter((item) => item.usb !== undefined).length,
    errors: researched.filter((item) => item.error).length,
    outputPath,
    unresolved: researched.filter((item) => item.classification === 'tv' && item.hdmi === undefined).map((item) => ({ id: item.id, name: item.name, pageTitle: item.pageTitle, ogTitle: item.ogTitle, sourceUrl: item.sourceUrl, error: item.error, counts: item.conflictingHdmi })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
