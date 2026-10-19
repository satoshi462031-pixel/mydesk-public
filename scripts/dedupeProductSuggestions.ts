/**
 * 同じカテゴリ・同じ表示名の候補を1件に絞る。行は削除せず、重複側だけ候補から外す。
 *
 *   npx tsx scripts/dedupeProductSuggestions.ts
 *   npx tsx scripts/dedupeProductSuggestions.ts --apply
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv, chunk } from './importRakuten'
import { productIdentity } from '../src/utils/productName'

type Product = {
  id: string
  name: string
  brand: string | null
  product_name: string | null
  category: string | null
  source: string | null
  is_suggestable: boolean
}

type ShopLink = { product_id: string; review_count: number | null }

const APPLY = process.argv.includes('--apply')
const compact = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const DISTINCT_VARIANT_CATEGORIES = new Set(['Accessory', 'Cable', 'Furniture', 'Instrument', 'Plant', 'PowerStrip'])

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const db = createAdminClient()
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 999)
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const products = (await fetchAll<Product>(
    'products',
    'id,name,brand,product_name,category,source,is_suggestable',
  )).filter((product) => product.is_suggestable)
  const links = await fetchAll<ShopLink>('shop_links', 'id,product_id,review_count')
  const reviews = new Map<string, number>()
  for (const link of links) reviews.set(link.product_id, Math.max(reviews.get(link.product_id) ?? 0, link.review_count ?? 0))

  const groups = new Map<string, Array<Product & { displayName: string }>>()
  for (const product of products) {
    const displayName = productIdentity(
      product.name,
      product.brand,
      product.product_name,
      product.source === 'preset',
    ).displayName
    const key = `${product.category ?? ''}\u0000${compact(displayName)}`
    const group = groups.get(key) ?? []
    group.push({ ...product, displayName })
    groups.set(key, group)
  }

  const duplicates = [...groups.values()].filter((group) =>
    group.length > 1 && !DISTINCT_VARIANT_CATEGORIES.has(group[0].category ?? ''))
  const losers: Array<Product & { displayName: string; keptId: string }> = []
  for (const group of duplicates) {
    const ordered = [...group].sort((a, b) => {
      const preset = Number(b.source === 'preset') - Number(a.source === 'preset')
      if (preset !== 0) return preset
      const review = (reviews.get(b.id) ?? 0) - (reviews.get(a.id) ?? 0)
      if (review !== 0) return review
      return a.id.localeCompare(b.id)
    })
    for (const product of ordered.slice(1)) losers.push({ ...product, keptId: ordered[0].id })
  }

  console.log(JSON.stringify({
    visible: products.length,
    duplicateGroups: duplicates.length,
    hiddenCandidates: losers.length,
    samples: duplicates.slice(0, 30).map((group) => ({
      category: group[0].category,
      displayName: group[0].displayName,
      count: group.length,
      rawNames: group.slice(0, 4).map((product) => product.name),
    })),
  }, null, 2))
  if (!APPLY || losers.length === 0) return

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `product-suggestion-dedupe-before-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(losers.map((product) => ({
    id: product.id,
    keptId: product.keptId,
    category: product.category,
    displayName: product.displayName,
    name: product.name,
    reviewCount: reviews.get(product.id) ?? 0,
    isSuggestableBefore: product.is_suggestable,
  })), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  let updated = 0
  for (const ids of chunk(losers.map((product) => product.id), 200)) {
    const { error } = await db.from('products').update({ is_suggestable: false }).in('id', ids)
    if (error) throw new Error(`重複候補の更新に失敗: ${error.message}`)
    updated += ids.length
  }
  console.log(`重複候補を非表示: ${updated}件`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
