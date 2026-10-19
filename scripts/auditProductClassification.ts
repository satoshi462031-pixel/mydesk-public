import { createAdminClient, loadEnv } from './importRakuten'

type Product = {
  name: string
  category: string | null
  subcategory: string | null
  is_suggestable: boolean
}

const IMPORTANT_TARGETS = new Set([
  'TV', 'Projector', 'Headphone', 'Earphone', 'StreamingDevice', 'PCPart',
  'Keyboard', 'Speaker', 'GameConsole', 'Controller', 'MobileBattery', 'Charger',
])

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const products: Product[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('name,category,subcategory,is_suggestable')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    products.push(...((data ?? []) as Product[]))
    if (!data || data.length < 1000) break
  }

  const categoryNames = [...new Set(products.map((product) => product.category ?? '未分類'))].sort()
  const categories = categoryNames.map((category) => {
    const rows = products.filter((product) => category === '未分類'
      ? product.category === null
      : product.category === category)
    const subcategories = [...rows.reduce((map, product) => {
      const key = product.subcategory ?? '-'
      map.set(key, (map.get(key) ?? 0) + 1)
      return map
    }, new Map<string, number>())].sort((a, b) => b[1] - a[1])
    return {
      category,
      total: rows.length,
      suggestable: rows.filter((product) => product.is_suggestable).length,
      hidden: rows.filter((product) => !product.is_suggestable).length,
      subcategories,
    }
  })

  const residuals = {
    smallDevicePcParts: products.filter((product) => product.category === 'SmallDevice' && /マザーボード|PCケース|電源ユニット|CPUクーラー|グラフィック/i.test(product.name)).map((product) => product.name),
    smallDeviceProjectors: products.filter((product) => product.category === 'SmallDevice' && /プロジェクター/i.test(product.name)).map((product) => product.name),
    monitorTvs: products.filter((product) => product.category === 'Monitor' && /テレビ|チューナーレス/i.test(product.name)).map((product) => product.name),
    headphoneEarphones: products.filter((product) => product.category === 'Headphone' && /イヤホン|イヤフォン|earbuds?/i.test(product.name)).map((product) => product.name),
  }

  console.log(JSON.stringify({
    total: products.length,
    categories: categories.sort((a, b) => {
      const important = Number(IMPORTANT_TARGETS.has(b.category)) - Number(IMPORTANT_TARGETS.has(a.category))
      return important || b.total - a.total
    }),
    residuals,
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
