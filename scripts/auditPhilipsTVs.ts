import { createClient } from '@supabase/supabase-js'
import { extractProductModel } from '../src/utils/productName'
import { loadEnv } from './importRakuten'

async function main(): Promise<void> {
  loadEnv()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase の接続設定がありません')
  const db = createClient(url, key)
  const { data, error } = await db
    .from('products')
    .select('id, name, brand, image, shop_links(shop, affiliate_url, official_url)')
    .eq('category', 'Monitor')
    .eq('brand', 'Philips')
    .ilike('name', '%テレビ%')
    .order('name')
  if (error) throw new Error(`Philipsテレビの取得に失敗: ${error.message}`)
  const truncated = (data ?? []).filter((product) => [...product.name].length === 48)
  const suggestionKeys = new Set((data ?? []).map((product) =>
    extractProductModel(product.name)?.toLowerCase() ?? product.name.toLowerCase(),
  ))
  console.log(JSON.stringify({
    total: data?.length ?? 0,
    truncated: truncated.length,
    uniqueSuggestions: suggestionKeys.size,
    products: (data ?? []).map((product) => ({
      id: product.id,
      name: product.name,
      urls: product.shop_links.map((link) => link.official_url),
    })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
