import { createAdminClient, loadEnv } from './importRakuten'
import { extractProductModel } from '../src/utils/productName'

type MonitorProduct = {
  id: string
  name: string
  brand: string | null
  source: string | null
  shop_links: Array<{
    shop: string
    official_url: string | null
    affiliate_url: string | null
  }>
}

async function main(): Promise<void> {
  if (process.argv.includes('--presets')) {
    const { GADGET_PRESETS } = await import('../src/constants/gadgetPresets')
    const monitors = GADGET_PRESETS.filter((preset) => preset.category === 'Monitor')
    for (const monitor of monitors) {
      const count = (type: string) => monitor.ports
        .filter((port) => port.type === type && port.direction === 'input')
        .reduce((sum, port) => sum + port.count, 0)
      console.log(`${monitor.name}\tHDMI=${count('HDMI')}\tDP=${count('DisplayPort')}`)
    }
    return
  }
  loadEnv()
  const db = createAdminClient()
  const { data, error } = await db
    .from('products')
    .select('id,name,brand,source,shop_links(shop,official_url,affiliate_url)')
    .eq('category', 'Monitor')
    .order('brand')
    .order('name')
  if (error) throw new Error(`モニター商品の取得に失敗: ${error.message}`)

  const products = (data ?? []) as MonitorProduct[]
  if (process.argv.includes('--compact')) {
    for (const product of products) {
      const rawUrl = product.shop_links.map((link) => link.official_url ?? link.affiliate_url).find(Boolean)
      let itemPath = ''
      if (rawUrl) {
        try {
          const affiliate = new URL(rawUrl)
          const target = affiliate.searchParams.get('pc')
          itemPath = target ? new URL(target).pathname : affiliate.pathname
        } catch {}
      }
      console.log([
        product.id,
        product.source ?? '-',
        product.brand ?? '-',
        extractProductModel(product.name) ?? '-',
        itemPath,
        product.name,
      ].join('\t'))
    }
    return
  }
  console.log(JSON.stringify({
    total: products.length,
    products: products.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      source: product.source,
      model: extractProductModel(product.name),
      urls: product.shop_links.map((link) => link.official_url ?? link.affiliate_url).filter(Boolean),
    })),
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
