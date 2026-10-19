import { createClient } from '@supabase/supabase-js'
import { extractProductModel } from '../src/utils/productName'
import { loadEnv, searchRakuten, sleep } from './importRakuten'

function urlKey(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return `${url.hostname.toLowerCase()}${decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase()}`
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  loadEnv()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase の接続設定がありません')
  const db = createClient(url, key)
  const { data, error } = await db
    .from('products')
    .select('id, name, brand, shop_links(official_url)')
    .eq('category', 'Monitor')
  if (error) throw new Error(`モニター商品の取得に失敗: ${error.message}`)

  const originalByUrl = new Map<string, string>()
  for (let page = 1; page <= 10; page += 1) {
    const items = await searchRakuten({ genreId: '110105', sort: '-reviewCount', page })
    for (const item of items ?? []) {
      const key = urlKey(item.itemUrl)
      if (key) originalByUrl.set(key, item.itemName)
    }
    if (page < 10) await sleep(1100)
  }

  const matched = (data ?? []).flatMap((product) => {
    const links = product.shop_links as Array<{ official_url: string | null }>
    const originalName = links
      .map((link) => originalByUrl.get(urlKey(link.official_url) ?? ''))
      .find((name) => name !== undefined)
    return originalName ? [{ ...product, originalName }] : []
  })
  const savedModelMissing = matched.filter((product) => !extractProductModel(product.name))
  const confirmedMissing = savedModelMissing.filter((product) => extractProductModel(product.originalName))
  const philips = matched.filter((product) => /philips|フィリップス/i.test(product.originalName))
  const databasePhilips = (data ?? []).filter((product) =>
    /philips|フィリップス/i.test(`${product.name} ${product.brand ?? ''}`),
  )

  console.log(JSON.stringify({
    databaseMonitors: data?.length ?? 0,
    currentRakutenItems: originalByUrl.size,
    matchedByItemUrl: matched.length,
    savedModelMissing: savedModelMissing.length,
    confirmedMissingFromSavedName: confirmedMissing.length,
    confirmedSamples: confirmedMissing.slice(0, 20).map((product) => ({
      saved: product.name,
      original: product.originalName,
      detectedModel: extractProductModel(product.originalName),
    })),
    philips: philips.slice(0, 20).map((product) => ({
      saved: product.name,
      original: product.originalName,
      savedModel: extractProductModel(product.name),
      originalModel: extractProductModel(product.originalName),
    })),
    databasePhilips: databasePhilips.map((product) => ({
      name: product.name,
      brand: product.brand,
      detectedModel: extractProductModel(product.name),
      length: [...product.name].length,
    })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
