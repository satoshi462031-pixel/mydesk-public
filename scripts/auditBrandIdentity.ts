// products.brand の表記ゆれを見る。
//
// brand は importRakutenGenres.ts の detectBrand が商品名の先頭から抜いた文字列なので、
// 同じメーカーが複数の表記で入る。src/utils/brandIdentity.ts がどこまで束ねられていて、
// どの表記が辞書から漏れているかをここで確認する（データは書き換えない）。
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BRAND_ENTRIES, brandEntry, brandKey, isNonBrand } from '../src/utils/brandIdentity'

type ProductRow = { brand: string | null; name: string; category: string | null }

function loadEnvFile(): void {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
}

async function fetchProducts(): Promise<ProductRow[]> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase の接続設定がありません')
  const db = createClient(url, key)
  const rows: ProductRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('brand,name,category')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as ProductRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

type Group = { key: string; known: boolean; count: number; variants: Map<string, number>; sample: string }

async function main(): Promise<void> {
  loadEnvFile()
  const rows = await fetchProducts()
  const groups = new Map<string, Group>()
  const nonBrands = new Map<string, number>()
  let noBrand = 0

  for (const row of rows) {
    // 規格名・対応機種名は取り込み側で弾くようにしたが、既存の行には残っている
    if (isNonBrand(row.brand)) {
      const raw = (row.brand ?? '').trim()
      nonBrands.set(raw, (nonBrands.get(raw) ?? 0) + 1)
      continue
    }
    const key = brandKey(row.brand)
    if (!key || !row.brand) { noBrand += 1; continue }
    let group = groups.get(key)
    if (!group) {
      group = { key, known: !!brandEntry(key), count: 0, variants: new Map(), sample: row.name }
      groups.set(key, group)
    }
    group.count += 1
    const raw = row.brand.trim()
    group.variants.set(raw, (group.variants.get(raw) ?? 0) + 1)
  }

  const all = [...groups.values()].sort((a, b) => b.count - a.count)
  const merged = all.filter((g) => g.variants.size > 1)
  const unknown = all.filter((g) => !g.known)
  // 1商品しか名乗っていないブランドは、detectBrand が商品名の先頭語を
  // そのまま拾った誤抽出のことが多い
  const singletons = unknown.filter((g) => g.count === 1)
  const unusedEntries = BRAND_ENTRIES.filter((entry) => !groups.has(entry.id))

  const variantList = (g: Group) => [...g.variants.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([raw, count]) => `${raw}(${count})`)

  const nonBrandTotal = [...nonBrands.values()].reduce((sum, count) => sum + count, 0)
  console.log(`商品 ${rows.length}件 / ブランドなし ${noBrand}件`)
  console.log(`ブランドではない表記として落としたもの ${nonBrandTotal}件（${nonBrands.size}種）`)
  console.log(`  ${[...nonBrands.entries()].sort((a, b) => b[1] - a[1]).map(([raw, count]) => `${raw}(${count})`).join(' / ') || '（なし）'}`)
  console.log(`表記 ${all.reduce((sum, g) => sum + g.variants.size, 0)}種 → ${all.length}ブランドに統合`)
  console.log(`  うち辞書で束ねたもの ${all.length - unknown.length} / 表記そのままのもの ${unknown.length}`)
  console.log('')

  console.log(`■ 複数表記が1つに束なったブランド ${merged.length}件`)
  for (const g of merged.slice(0, 40)) {
    console.log(`  ${g.key.padEnd(20)} ${g.count.toString().padStart(4)}件  ${variantList(g).join(' / ')}`)
  }
  console.log('')

  console.log(`■ 辞書に無く件数の多いブランド 上位30（表へ足す候補）`)
  for (const g of unknown.filter((g) => g.count > 1).slice(0, 120)) {
    console.log(`  ${g.key.padEnd(20)} ${g.count.toString().padStart(4)}件  ${variantList(g).join(' / ')}`)
  }
  console.log('')

  console.log(`■ 1商品しか名乗っていないブランド ${singletons.length}件（detectBrand の誤抽出候補・先頭10件）`)
  for (const g of singletons.slice(0, 10)) {
    console.log(`  ${[...g.variants.keys()][0]}  ← ${g.sample.slice(0, 60)}`)
  }
  console.log('')

  console.log(`■ 辞書にあるが商品が1件も無いブランド ${unusedEntries.length}件`)
  console.log(`  ${unusedEntries.map((entry) => entry.en).join(', ') || '（なし）'}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
