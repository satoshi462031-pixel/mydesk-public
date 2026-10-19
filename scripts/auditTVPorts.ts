import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'
import { extractProductModel } from '../src/utils/productName'

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const { data, error } = await db
    .from('products')
    .select('id,name,brand,category,ports,specs_source_url,specs_verified_at,shop_links(shop,official_url,affiliate_url)')
    .or('category.eq.TV,and(category.eq.Monitor,name.ilike.%テレビ%),and(category.eq.Monitor,name.ilike.%チューナーレス%)')
    .order('name')
  if (error) throw new Error(`テレビ商品の取得に失敗: ${error.message}`)

  const products = data ?? []
  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outputPath = resolve(backupDir, `tv-port-audit-${stamp}.json`)
  writeFileSync(outputPath, JSON.stringify(products, null, 2))
  const modelGroups = new Map<string, typeof products>()
  for (const product of products) {
    const model = extractProductModel(product.name) ?? '型番不明'
    modelGroups.set(model, [...(modelGroups.get(model) ?? []), product])
  }
  console.log(JSON.stringify({
    total: products.length,
    tvCategory: products.filter((product) => product.category === 'TV').length,
    legacyMonitor: products.filter((product) => product.category === 'Monitor').length,
    withPorts: products.filter((product) => Array.isArray(product.ports) && product.ports.length > 0).length,
    outputPath,
    modelGroups: [...modelGroups.entries()].map(([model, items]) => ({
      model,
      count: items.length,
      ids: items.map((item) => item.id),
      names: items.map((item) => item.name),
    })),
    products: products.map((product) => ({ id: product.id, name: product.name, brand: product.brand })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
