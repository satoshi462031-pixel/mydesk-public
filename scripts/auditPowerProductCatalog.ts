import { createAdminClient, loadEnv } from './importRakuten'
import { extractProductModel } from '../src/utils/productName'

const CATEGORIES = ['MobileBattery', 'PowerStrip'] as const
const MOBILE_BATTERY = /モバイルバッテリー|バッテリーパック|power\s*(?:bank|core)|magnetic battery|smartcoby|battery pack|AUKEY Basix|cheero Power Plus|RAVPower|Baseus Blade/i
const MOBILE_BATTERY_EXCLUDE = /互換|交換|ノート(?:PC|パソコン)|CMOS|charger|充電器|ワイヤレス充電器|charging/i
const REPLACEMENT_BATTERY = /互換|交換用?|内[蔵臓]バッテリー|純正バッテリー|ノート(?:PC|パソコン)|ラップトップ|タブレット用|スマホ用バッテリー|電池パック|battery\s+(?:for|replacement)|対応機種|PSE認証済.*(?:PC|パソコン)/i
const MISCLASSIFIED_MOBILE_BATTERY = /バッテリーチャージャー|充電器|充電スタンド|ワイヤレス充電|ACアダプタ|電源アダプタ|USBケーブル|充電ケーブル|ハンディファン|扇風機|バッテリーケース|収納ケース|保護ケース|ホルダー|残量チェッカー|テスター/i
const POWER_STRIP = /電源タップ|OAタップ|テーブルタップ|コンセントタップ|延長コード|power\s*strip/i
const POWER_STRIP_EXCLUDE = /タイマー|スマートプラグ|温湿度計|コンセントカバー/i

function isCandidate(category: typeof CATEGORIES[number], name: string): boolean {
  return category === 'MobileBattery'
    ? MOBILE_BATTERY.test(name) && !MOBILE_BATTERY_EXCLUDE.test(name)
    : POWER_STRIP.test(name) && !POWER_STRIP_EXCLUDE.test(name)
}

function classifyMobileBattery(name: string): 'actual' | 'replacement' | 'misclassified' | 'unknown' {
  if (/Baseus Blade 2/i.test(name)) return 'actual'
  if (REPLACEMENT_BATTERY.test(name)) return 'replacement'
  if (MISCLASSIFIED_MOBILE_BATTERY.test(name)) return 'misclassified'
  if (MOBILE_BATTERY.test(name)) return 'actual'
  return 'unknown'
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  for (const category of CATEGORIES) {
    if (process.argv.includes('--mobile') && category !== 'MobileBattery') continue
    const { data, error } = await db
      .from('products')
      .select('id,name,brand,description,source,ports,specs_source_url,shop_links(shop,official_url,affiliate_url)')
      .eq('category', category)
      .order('brand')
      .order('name')
    if (error) throw new Error(`${category}の商品取得に失敗: ${error.message}`)
    const candidates = (data ?? []).filter((product) => isCandidate(category, product.name))
    console.log(`\n[${category}] 全${data?.length ?? 0}件 / 本体候補${candidates.length}件 / 仕様登録済み${(data ?? []).filter((product) => Array.isArray(product.ports)).length}件`)
    if (category === 'MobileBattery') {
      const classifications = (data ?? []).reduce<Record<string, number>>((counts, product) => {
        const classification = classifyMobileBattery(product.name)
        counts[classification] = (counts[classification] ?? 0) + 1
        return counts
      }, {})
      console.log(`[分類] ${Object.entries(classifications).map(([key, value]) => `${key}:${value}`).join(' / ')}`)
    }
    if (process.argv.includes('--summary')) continue
    const selected = process.argv.includes('--unknown') && category === 'MobileBattery'
      ? (data ?? []).filter((product) => classifyMobileBattery(product.name) === 'unknown')
      : process.argv.includes('--classification') && category === 'MobileBattery'
        ? (data ?? []).filter((product) => classifyMobileBattery(product.name) === process.argv[process.argv.indexOf('--classification') + 1])
      : process.argv.includes('--candidates')
      ? candidates
      : process.argv.includes('--unverified-candidates')
        ? candidates.filter((product) => !Array.isArray(product.ports))
        : (data ?? [])
    for (const product of selected) {
      const rawUrl = product.shop_links
        .map((link) => link.official_url ?? link.affiliate_url)
        .find(Boolean)
      let itemPath = ''
      if (rawUrl) {
        try {
          const url = new URL(rawUrl)
          const target = url.searchParams.get('pc')
          itemPath = target ? new URL(target).pathname : url.pathname
        } catch {}
      }
      console.log([
        product.id,
        category === 'MobileBattery' ? classifyMobileBattery(product.name) : '-',
        product.source ?? '-',
        product.brand ?? '-',
        extractProductModel(product.name) ?? '-',
        Array.isArray(product.ports) ? 'ports' : '-',
        itemPath,
        product.name,
        process.argv.includes('--with-description') ? (product.description ?? '').replace(/\s+/g, ' ').slice(0, 500) : '',
      ].join('\t'))
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
