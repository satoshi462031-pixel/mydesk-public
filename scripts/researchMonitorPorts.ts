import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'

type Product = {
  id: string
  name: string
  brand: string | null
  source: string | null
  shop_links: Array<{ official_url: string | null; affiliate_url: string | null }>
}

type Candidate = {
  id: string
  name: string
  sourceUrl?: string
  hdmi?: number
  displayPort?: number
  evidence: string[]
  skipped?: string
  error?: string
}

const NON_MONITOR = /リモコン|ケーブル|互換品\s*(?:液晶|ディスプレイ)|サウンドシステム|テレビ|\bTV\b|AQUOS|VIERA|BRAVIA|REGZA/i

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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number(value)))
    .replace(/\s+/g, ' ')
}

function explicitCounts(text: string, kind: 'hdmi' | 'dp'): Array<{ count: number; evidence: string }> {
  const patterns = kind === 'hdmi'
    ? [/(?:mini\s*)?HDMI(?:\s*\d(?:\.\d)?)?\s*[×xX]\s*(\d+)/gi, /HDMI\s*入力\s*(\d+)\s*系統/gi]
    : [/(?:DisplayPort|Display\s*Port|DP)(?:\s*\d(?:\.\d)?)?\s*[×xX]\s*(\d+)/gi, /DisplayPort\s*入力\s*(\d+)\s*系統/gi]
  const results: Array<{ count: number; evidence: string }> = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(match[1])
      if (!Number.isInteger(count) || count < 0 || count > 8) continue
      const index = match.index ?? 0
      results.push({ count, evidence: text.slice(Math.max(0, index - 45), index + match[0].length + 45) })
    }
  }
  return results
}

function uniqueCount(values: Array<{ count: number; evidence: string }>): number | undefined {
  const counts = [...new Set(values.map((value) => value.count))]
  return counts.length === 1 ? counts[0] : undefined
}

async function research(product: Product): Promise<Candidate> {
  if (NON_MONITOR.test(product.name)) return { id: product.id, name: product.name, evidence: [], skipped: 'non-monitor' }
  const sourceUrl = itemUrl(product)
  if (!sourceUrl) return { id: product.id, name: product.name, evidence: [], skipped: 'no-source-url' }
  try {
    const response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MyDeskMonitorSpecAudit/1.0)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = textFromHtml(await response.text())
    const hdmiMatches = explicitCounts(text, 'hdmi')
    const dpMatches = explicitCounts(text, 'dp')
    return {
      id: product.id,
      name: product.name,
      sourceUrl,
      hdmi: uniqueCount(hdmiMatches),
      displayPort: uniqueCount(dpMatches),
      evidence: [...hdmiMatches, ...dpMatches].slice(0, 8).map((match) => match.evidence),
    }
  } catch (error) {
    return {
      id: product.id,
      name: product.name,
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
    .select('id,name,brand,source,shop_links(official_url,affiliate_url)')
    .eq('category', 'Monitor')
  if (error) throw new Error(`モニター商品の取得に失敗: ${error.message}`)
  const products = (data ?? []) as Product[]
  const candidates: Candidate[] = []
  for (let index = 0; index < products.length; index += 6) {
    candidates.push(...await Promise.all(products.slice(index, index + 6).map(research)))
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputPath = resolve(backupDir, `monitor-port-research-${stamp}.json`)
  writeFileSync(outputPath, JSON.stringify(candidates, null, 2))
  console.log(JSON.stringify({
    total: candidates.length,
    complete: candidates.filter((candidate) => candidate.hdmi !== undefined && candidate.displayPort !== undefined).length,
    partial: candidates.filter((candidate) => (candidate.hdmi !== undefined) !== (candidate.displayPort !== undefined)).length,
    noCounts: candidates.filter((candidate) => candidate.hdmi === undefined && candidate.displayPort === undefined && !candidate.skipped).length,
    skipped: candidates.filter((candidate) => candidate.skipped).length,
    errors: candidates.filter((candidate) => candidate.error).length,
    outputPath,
    candidates: candidates.filter((candidate) => candidate.hdmi !== undefined || candidate.displayPort !== undefined),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
