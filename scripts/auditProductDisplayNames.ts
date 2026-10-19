import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractProductModel, productIdentity } from '../src/utils/productName'

type ProductRow = {
  name: string
  brand: string | null
  product_name?: string | null
  category: string | null
  source: string | null
  is_suggestable: boolean
}

function loadEnvFile(): void {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
}

async function main(): Promise<void> {
  loadEnvFile()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase の接続設定がありません')
  const db = createClient(url, key)
  const rows: ProductRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('name,brand,product_name,category,source,is_suggestable')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as ProductRow[]))
    if (!data || data.length < 1000) break
  }

  const results = rows.map((row) => ({ row, identity: productIdentity(row.name, row.brand, row.product_name) }))
  const compact = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const suggestable = results.filter(({ row }) => row.is_suggestable)
  const storedBrand = suggestable.filter(({ row }) => row.brand && row.product_name
    && compact(row.product_name).includes(compact(row.brand)))
  const brandOnly = suggestable.filter(({ row }) => row.brand && row.product_name
    && compact(row.product_name) === compact(row.brand))
  const modelOnly = suggestable.filter(({ identity }) => {
    const model = extractProductModel(identity.productName)
    return !!model && compact(identity.productName) === compact(model)
  })
  const duplicateBrand = results.filter(({ identity }) => identity.brand
    && identity.displayName !== identity.productName
    && compact(identity.productName).includes(compact(identity.brand)))
  const over60 = results.filter(({ identity }) => [...identity.displayName].length > 60)
  const promotion = results.filter(({ identity }) =>
    /送料無料|ポイント|ランキング|最安|セール|SALE|翌日発送|抽選|プレゼント|おまけ/i.test(identity.displayName))
  const specificationHeavy = results.filter(({ identity }) =>
    /(?:\d+(?:\.\d+)?(?:GB|TB|mAh|Hz|mm|cm|kg|W|インチ)){2,}/i.test(identity.displayName))

  console.log(JSON.stringify({
    total: results.length,
    suggestable: suggestable.length,
    productNameMissing: suggestable.filter(({ row }) => !row.product_name?.trim()).length,
    storedBrand: storedBrand.length,
    brandOnly: brandOnly.length,
    modelOnly: modelOnly.length,
    empty: results.filter(({ identity }) => !identity.productName).length,
    duplicateBrand: duplicateBrand.length,
    over60: over60.length,
    promotionResidual: promotion.length,
    specificationHeavy: specificationHeavy.length,
    averageLength: Number((results.reduce((sum, { identity }) => sum + [...identity.displayName].length, 0) / results.length).toFixed(1)),
    brandOnlySamples: brandOnly.slice(0, 15).map(({ row }) => ({
      category: row.category,
      brand: row.brand,
      productName: row.product_name,
      source: row.source,
    })),
    modelOnlySamples: modelOnly.slice(0, 15).map(({ row, identity }) => ({
      category: row.category,
      brand: row.brand,
      productName: identity.productName,
      source: row.source,
    })),
    longestSamples: [...results]
      .sort((a, b) => [...b.identity.displayName].length - [...a.identity.displayName].length)
      .slice(0, 15)
      .map(({ row, identity }) => ({ category: row.category, before: row.name, after: identity.displayName })),
    promotionSamples: promotion.slice(0, 15).map(({ row, identity }) => ({ before: row.name, after: identity.displayName })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
