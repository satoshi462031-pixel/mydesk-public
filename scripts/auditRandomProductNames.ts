/**
 * 候補に表示される商品から決定的な乱数で抽出し、商品名とカテゴリの異常を監査する。
 *
 *   npx tsx scripts/auditRandomProductNames.ts --sample 1000 --seed 20260927
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { classifyProduct } from './reclassifyProductCategories'
import { createAdminClient, loadEnv } from './importRakuten'
import { productIdentity } from '../src/utils/productName'

type Product = {
  id: string
  name: string
  brand: string | null
  product_name: string | null
  category: string | null
  subcategory: string | null
  source: string | null
  is_suggestable: boolean
}

type Finding = {
  id: string
  category: string | null
  displayName: string
  rawName: string
  reasons: string[]
}

const valueAfter = (flag: string, fallback: number): number => {
  const index = process.argv.indexOf(flag)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

const SAMPLE_SIZE = valueAfter('--sample', 1000)
const SEED = valueAfter('--seed', 20260927)
const compact = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function sample<T>(values: T[], size: number, seed: number): T[] {
  const result = [...values]
  const next = random(seed)
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(next() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result.slice(0, Math.min(size, result.length))
}

function reasonsFor(row: Product, displayName: string): string[] {
  const reasons: string[] = []
  const next = classifyProduct(row)
  if (next.category !== row.category || next.subcategory !== row.subcategory || next.isSuggestable !== row.is_suggestable) {
    reasons.push('classification-drift')
  }
  if (/レンタル|中古|新古品|整備済み品|アウトレット|訳あり|わけあり|パッケージ傷み/i.test(row.name)) {
    reasons.push('non-canonical-offer')
  }
  if (/送料無料|ポイント\d*倍|ランキング|最安|セール|SALE|翌日発送|抽選|プレゼント|おまけ/i.test(displayName)) {
    reasons.push('promotion-residual')
  }
  if (/^(?:新品|正規品|純正品|限定特価|在庫処分)(?:\s|$)/i.test(displayName)) reasons.push('sales-prefix')
  if (/[ぁ-んァ-ヶ一-龠A-Za-z]{2,}(?:パッ|キッ|ステー|アダプ|コントロー|キーボー|バッテリ|プロジェクタ)$/u.test(displayName)) {
    reasons.push('truncated-ending')
  }
  if (/[^\s]@\d*$|[（(［[][^）)］\]]*$/.test(displayName)) reasons.push('broken-ending')
  if (!row.product_name?.trim() || !displayName.trim()) reasons.push('missing-name')
  if ([...displayName].length > 60) reasons.push('over-60')
  return reasons
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const products: Product[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id,name,brand,product_name,category,subcategory,source,is_suggestable')
      .eq('is_suggestable', true)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    products.push(...((data ?? []) as Product[]))
    if (!data || data.length < 1000) break
  }

  const selected = sample(products, SAMPLE_SIZE, SEED)
  const identities = selected.map((row) => ({
    row,
    displayName: productIdentity(row.name, row.brand, row.product_name, row.source === 'preset').displayName,
  }))
  const duplicateCounts = new Map<string, number>()
  for (const { row, displayName } of identities) {
    const key = `${row.category ?? ''}\u0000${compact(displayName)}`
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1)
  }
  const findings: Finding[] = identities.flatMap(({ row, displayName }) => {
    const reasons = reasonsFor(row, displayName)
    const key = `${row.category ?? ''}\u0000${compact(displayName)}`
    if ((duplicateCounts.get(key) ?? 0) > 1) reasons.push('sample-duplicate')
    return reasons.length > 0 ? [{ id: row.id, category: row.category, displayName, rawName: row.name, reasons }] : []
  })

  const reasonCounts = [...findings.flatMap((finding) => finding.reasons).reduce((map, reason) => {
    map.set(reason, (map.get(reason) ?? 0) + 1)
    return map
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1])
  const report = {
    seed: SEED,
    population: products.length,
    sampleSize: selected.length,
    findings: findings.length,
    reasonCounts,
    rows: findings,
  }
  const outputDir = resolve(process.cwd(), 'docs', 'audits')
  mkdirSync(outputDir, { recursive: true })
  const outputPath = resolve(outputDir, `random-product-name-audit-${SEED}.json`)
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, rows: findings.slice(0, 80), outputPath }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
