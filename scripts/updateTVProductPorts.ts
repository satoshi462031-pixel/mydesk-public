import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'

type TVSpec = {
  hdmi: number
  usbA?: number
  ethernet?: boolean
  audioOut?: boolean
  opticalOut?: boolean
  sourceUrl: string
}

type Rule = TVSpec & { pattern: RegExp }

const rules: Rule[] = [
  { pattern: /(?:24|32|40)V35N/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.regza.com/tv/lineup/v35n/spec' },
  { pattern: /(?:43|50|55|65|75)M550M|65M550L/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.regza.com/tv/lineup/m550m/spec' },
  { pattern: /(?:65|75)Z870N/i, hdmi: 4, usbA: 4, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.regza.com/tv/lineup/z870n/spec' },
  { pattern: /75Z770L/i, hdmi: 4, usbA: 4, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.regza.com/tv/lineup/z770l/spec' },
  { pattern: /(?:43Z670R|55Z770R|55X8900R)/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.regza.com/tv/lineup/z670r/spec' },
  { pattern: /(?:55X8900L|75Z970M)/i, hdmi: 4, usbA: 4, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.regza.com/tv/lineup/x8900l/spec' },

  { pattern: /2T-C(?:19|24|32)GE1/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://jp.sharp/aquos/products/ge1/spec/' },
  { pattern: /2T-C(?:32GF1|43GF2)/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://jp.sharp/aquos/products/gf1/spec/' },
  { pattern: /4T-C(?:42|50)FL1/i, hdmi: 4, usbA: 3, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://jp.sharp/aquos/products/fl1/spec/' },
  { pattern: /4T-C(?:43FN2|43GN2|50FN2|55FN2|65FN1)/i, hdmi: 4, usbA: 3, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://jp.sharp/aquos/products/fn1/spec/' },
  { pattern: /4T-C50CH1/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://jp.sharp/aquos/products/ch1/spec/' },
  { pattern: /4T-C(?:60EN1|70EN1|75EL1)/i, hdmi: 4, usbA: 3, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://jp.sharp/aquos/products/en1/spec/' },

  { pattern: /(?:32PHH6569\/11)/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, sourceUrl: 'https://www.philips.co.jp/c-p/32PHH6569_11/6500-series-philips-smart-led-display' },
  { pattern: /(?:40|43)?PQT6731/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, sourceUrl: 'https://www.philips.com.tw/c-p/43PQT6731_96/6700-series-philips-smart-qled-display' },
  { pattern: /(?:43|50)?PUH7169(?:\/11)?/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, sourceUrl: 'https://www.documents.philips.com/assets/20250218/280abc2c7941446c8a18b28800adb874.pdf' },
  { pattern: /(?:55|65)PUH7700\/11/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, sourceUrl: 'https://www.documents.philips.com/assets/20260127/ddeb8bd639ae4ea093bcb3df00adaf95.pdf' },
  { pattern: /55MLED800\/11/i, hdmi: 3, usbA: 3, ethernet: true, audioOut: true, sourceUrl: 'https://www.documents.philips.com/assets/20251117/6fc11efbf298426aa7beb39800afd59e.pdf' },

  { pattern: /(?:JG32|JG40|JG43)-PB|CG(?:32|40|43)-P2/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://fpdvision.jp/products/fpd-43-inch-google-tv-tuner-hdr10-jg43-pb' },
  { pattern: /CG(?:43|50|55|65|70)-C[23]|cg(?:43|50|55|65|70)-c[23]/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://fpdvision.jp/pages/fpd-google-tv-trouble-shooting' },
  { pattern: /(?:FPD-50S|FPD-65I|cg50-s2|cg65-s2)/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://fpdvision.jp/pages/user-manual' },
  { pattern: /(?:FPD-58GF|jg58-p1)/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://fpdvision.jp/pages/user-manual' },

  { pattern: /(?:32|40)S5(?:1)?K/i, hdmi: 2, usbA: 1, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.tcl.com/content/dam/brandsite/region/japan/products/tv/s-series/s5k/S5K_%E5%8F%96%E6%89%B1%E8%AA%AC%E6%98%8E%E6%9B%B820250513.pdf' },
  { pattern: /(?:43C645|C645)/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://static-obg.tcl.com/content/dam/brandsite/region/japan/downloads/c645/80120-002627-C645%E8%AA%AC%E6%98%8E%E6%9B%B8.pdf' },
  { pattern: /(?:43|55)P61K/i, hdmi: 3, usbA: 2, ethernet: true, opticalOut: true, sourceUrl: 'https://www.tcl.com/content/dam/brandsite/region/japan/products/tv/p-series/p61k/P61K_%E5%8F%96%E6%89%B1%E8%AA%AC%E6%98%8E%E6%9B%B8_20250912.pdf' },
  { pattern: /(?:50P7K|75P79B|P755|65C655)/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://static-obg.tcl.com/content/dam/brandsite/region/japan/products/tv/p-series/p755/P755_%E5%8F%96%E6%89%B1%E8%AA%AC%E6%98%8E%E6%9B%B8.pdf' },

  { pattern: /43C55R/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.hisense.co.jp/tv/c55r/d5.php' },
  { pattern: /50U8R/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.hisense.co.jp/tv/u8r/d6.php' },
  { pattern: /55UT8000PJB/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.lg.com/jp/tvs-soundbars/lcd-tvs/55ut8000pjb/' },

  { pattern: /TV-(?:43|50)W80A/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TV-50W80A/spec.html' },
  { pattern: /TV-(?:43|50)W80B/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TV-50W80B/spec.html' },
  { pattern: /TV-(?:43|55)W90A/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TV-43W90A/spec.html' },
  { pattern: /TV-43W90B/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TV-43W90B/spec.html' },
  { pattern: /TV-48Z90B/i, hdmi: 4, usbA: 3, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TV-48Z90B/spec.html' },
  { pattern: /TH-(?:24|32)J300/i, hdmi: 2, usbA: 1, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TH-32J300/spec.html' },
  { pattern: /TH-(?:43|50)MR770/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TH-43MR770/spec.html' },
  { pattern: /TH-55LW2L/i, hdmi: 3, usbA: 3, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TH-55LW2L/spec.html' },
  { pattern: /TH-43LF2(?:\/LF2L)?/i, hdmi: 5, usbA: 3, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://panasonic.jp/viera/products/TH-43LF2/spec.html' },

  { pattern: /K-(?:55|65)XR50/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.sony.jp/bravia/products/K-XR50/spec/' },
  { pattern: /K-32W840/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.sony.jp/bravia/products/K-W840/spec/' },
  { pattern: /(?:KJ-50X80L|KJ-50X83L|KJ-50X85K|XRJ-50X90K|XRJ-55X90L)/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.sony.jp/bravia/products/X80L/spec/' },

  { pattern: /Xiaomi TV A Pro/i, hdmi: 3, usbA: 1, ethernet: true, sourceUrl: 'https://www.mi.com/jp/event/tv-comparison/' },
  { pattern: /Xiaomi TV (?:Max|S Mini LED|S mini LED)/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.mi.com/jp/event/tv-comparison/' },
  { pattern: /ANM010W/i, hdmi: 1, usbA: 1, audioOut: true, sourceUrl: 'https://www.keiyoeng.co.jp/wp-content/uploads/2024/02/AN-M010%E5%8F%96%E6%89%B1%E4%B8%80%E8%A6%A7-202401116.pdf' },
  { pattern: /RCA-?32D1/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.keiyoeng.co.jp/product/rca-32d1/' },
  { pattern: /J43CH06/i, hdmi: 2, usbA: 1, ethernet: true, audioOut: true, sourceUrl: 'https://maxzen.jp/product/j43ch06/' },
  { pattern: /SLHD241/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://doshisha-orion.com/tless-smarttv/' },
  { pattern: /OL50RD600/i, hdmi: 4, usbA: 1, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://doshisha-orion.com/product/tv/ol50rd600/' },
  { pattern: /32WB10PB/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, sourceUrl: 'https://www.irisohyama.co.jp/products/electrical-appliances/large-appliances/luca/tv/full-high-vision-lcd-tv/' },
  { pattern: /LT-32WGX-F1/i, hdmi: 2, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://www.irisohyama.co.jp/products/electrical-appliances/large-appliances/luca/tv/google-tv/' },
  { pattern: /KONKA|680シリーズ/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, sourceUrl: 'https://item.rakuten.co.jp/amoll/konka-tv/' },
  { pattern: /TLD-244HR/i, hdmi: 2, usbA: 1, ethernet: true, audioOut: true, sourceUrl: 'https://wis-sales.jp/products/tld-244hr/' },
  { pattern: /JU75QN9SG/i, hdmi: 3, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://item.rakuten.co.jp/a-price/6926130592212/' },
  { pattern: /JL24M10GP/i, hdmi: 2, usbA: 1, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://maxzen.jp/product/jl24m10gp/' },
  { pattern: /WIS-DVD32/i, hdmi: 3, usbA: 1, audioOut: true, sourceUrl: 'https://item.rakuten.co.jp/wis-shop/10000018/' },
  { pattern: /WIS-22/i, hdmi: 2, usbA: 1, audioOut: true, sourceUrl: 'https://item.rakuten.co.jp/wis-shop/10000046/' },
  { pattern: /SP-24TVD-02/i, hdmi: 2, usbA: 1, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://simplus.style/sp-24tvd-02/' },
  { pattern: /MVU75CH06/i, hdmi: 4, usbA: 2, ethernet: true, audioOut: true, opticalOut: true, sourceUrl: 'https://maxzen.jp/product/mvu75ch06/' },
  { pattern: /UN-15LD12H/i, hdmi: 1, usbA: 1, ethernet: true, sourceUrl: 'https://panasonic.jp/privateviera/products/UN-15LD12H/spec.html' },
  { pattern: /UN-19F10-K/i, hdmi: 1, usbA: 1, sourceUrl: 'https://panasonic.jp/privateviera/products/UN-19F10/spec.html' },
]

const MODEL_HINTS = new Map<string, string>([
  ['f15c4a99-6f01-4f40-9f0a-a947dfaf5d66', 'JL24M10GP'],
  ['419cef9b-4096-4b81-b4e7-adf1e98895de', 'UN-15LD12H'],
  ['c4f72ef0-dd81-4475-86af-42b8863a1339', 'TH-55LW2L'],
  ['60c04eed-c66f-4775-b0f2-4a1bfb030a02', 'TV-43W80A'],
  ['51995e59-3420-48a6-8b46-76d19cc98fd9', 'TV-55W90A'],
  ['78c08cd5-4162-40a6-852e-3f75e779758d', '65C655'],
  ['ccf5512e-f48f-4d48-9a61-6699a4f7b4b5', '32S5K'],
  ['e6d8e77d-9401-48d0-b617-e529e152290e', '40S5K'],
  ['4f4c5972-d4c9-4a60-9f05-4af5e31bdb89', '24V35N'],
  ['2d772579-2659-4098-a360-1d7438e6b8be', '40V35N'],
  ['f35ce044-2842-4095-a49d-d61d7a289e9f', 'WIS-DVD32'],
  ['de295e78-d7d4-40ab-b54e-0a40be7f29cd', 'WIS-22'],
  ['e8b386ef-a8d7-4cf5-8b1e-04fa5e0bd7aa', 'SP-24TVD-02'],
  ['dcdcbff7-d5f3-4800-bbe9-59174203b9a1', 'K-32W840'],
  ['9e6f2416-26e0-4329-b79b-a4ba7ddef64f', '4T-C43FN2'],
  ['e265c9cb-612a-4ab4-a605-90148b8b311d', '4T-C50FN2'],
  ['9bc126d9-6101-4138-81c4-c690575a7559', '4T-C50FL1'],
  ['71199b8b-df72-490f-9fdc-5f0535d44350', '43M550M'],
  ['563b034d-571e-4e7f-96aa-c6d1de192f10', 'MVU75CH06'],
  ['60be57ec-5649-4fee-9959-7a39ab6c3f10', '4T-C50CH1'],
  ['9c14a6d7-54f1-44de-910c-e5892916ddc8', '4T-C50CH1'],
  ['b4cc271c-5469-4074-95ec-9174d99097a7', '4T-C55FN2'],
  ['d2600045-40c1-45bf-abe6-998a92507136', '55M550M'],
  ['1694151c-5c46-47a3-8f04-e2869fb2d926', '4T-C60EN1'],
  ['5d7cfd18-ed5b-497f-8607-26e7c4db777e', '4T-C60EN1'],
  ['2469b0f1-24a1-4819-a609-2e367ddc1d09', '4T-C65FN1'],
  ['b47f1535-d503-4feb-aa4c-b72f7194bc73', '4T-C70EN1'],
  ['dd4b89a4-715b-480f-a17e-47c5f4ba7666', '75P79B'],
  ['b9e6b3fd-ddb6-4c7f-93e2-316c8687335e', 'JU75QN9SG'],
  ['4c878316-b1b3-4a0b-a801-bc32a29dea9a', '4T-C75EL1'],
  ['2dbf2220-3c97-407b-bf7c-e4de89580a27', 'LT-32WGX-F1'],
  ['bcc53a1a-d9f8-4af8-87b8-f801680f04c6', 'TV-43W90B'],
  ['9378f96a-b2af-45aa-a105-faeeaeaa3201', 'TH-43MR770'],
  ['e0b1e3eb-5cc6-4480-bc99-9bd9c2144c92', 'TH-50MR770'],
  ['2ec97e31-7147-432a-a05e-f85814ef397a', '65M550L'],
  ['b4581d7b-8f20-4c63-8110-7939c0acfee5', '65M550M'],
  ['ce2e2f66-fdd0-4841-b28e-678c25fc9112', '75M550M'],
  ['13665094-8ea1-4544-ade1-7bb557282531', '24V35N'],
  ['30a5ba46-3b72-4223-af47-e48a2374c1f2', '32V35N'],
  ['1f529401-2135-4f83-b469-4ec8cf2eafe2', 'UN-19F10-K'],
  ['9b8b8e99-610f-4c13-88a2-981594a8241a', 'TH-43LF2/LF2L'],
])

function buildPorts(spec: TVSpec): Port[] {
  return [
    { id: 'hdmi-input', type: 'HDMI', direction: 'input', count: spec.hdmi, supportsVideo: true },
    ...(spec.usbA ? [{ id: 'usba-host', type: 'USB_A' as const, direction: 'output' as const, count: spec.usbA, label: 'USB機器 / 録画用' }] : []),
    ...(spec.ethernet ? [{ id: 'ethernet-input', type: 'Ethernet' as const, direction: 'input' as const, count: 1 }] : []),
    ...(spec.audioOut ? [{ id: 'audio-output', type: 'Audio3_5mm' as const, direction: 'output' as const, count: 1 }] : []),
    ...(spec.opticalOut ? [{ id: 'optical-output', type: 'OpticalAudio' as const, direction: 'output' as const, count: 1 }] : []),
  ]
}

function comparable(ports: unknown): string {
  if (!Array.isArray(ports)) return '[]'
  return JSON.stringify(ports.map((port) => ({
    type: port?.type,
    direction: port?.direction,
    count: port?.count,
    label: port?.label,
    supportsVideo: port?.supportsVideo,
  })))
}

async function main(): Promise<void> {
  loadEnv()
  const apply = process.argv.includes('--apply')
  const verify = process.argv.includes('--verify')
  const db = createAdminClient()
  const { data, error } = await db.from('products')
    .select('id,name,brand,category,ports,specs_source_url,specs_verified_at,shop_links(affiliate_url,official_url)')
    .eq('category', 'TV')
    .order('name')
  if (error) throw new Error(`テレビ商品の取得に失敗: ${error.message}`)

  const products = data ?? []
  const matched = products.flatMap((product) => {
    const links = Array.isArray(product.shop_links) ? product.shop_links : []
    const searchText = [product.name, MODEL_HINTS.get(product.id), ...links.flatMap((link) => [link.affiliate_url, link.official_url])].filter(Boolean).join(' ')
    const rule = rules.find((candidate) => candidate.pattern.test(searchText))
    if (!rule) return []
    return [{ product, rule, ports: buildPorts(rule) }]
  })
  const unmatched = products.filter((product) => !matched.some((item) => item.product.id === product.id))

  if (verify) {
    const mismatches = matched.filter(({ product, rule, ports }) =>
      comparable(product.ports) !== comparable(ports)
      || product.specs_source_url !== rule.sourceUrl
      || !product.specs_verified_at)
    if (mismatches.length) throw new Error(`検証不一致 ${mismatches.length}件: ${mismatches.map(({ product }) => product.name).join(' / ')}`)
    console.log(`${matched.length}件のテレビ端子仕様を検証しました（無変更 ${unmatched.length}件）`)
    return
  }

  const report = {
    total: products.length,
    matched: matched.length,
    unmatched: unmatched.length,
    updates: matched.map(({ product, rule }) => ({ id: product.id, name: product.name, hdmi: rule.hdmi, usbA: rule.usbA ?? 0, sourceUrl: rule.sourceUrl })),
    unchanged: unmatched.map((product) => ({ id: product.id, name: product.name })),
  }
  console.log(JSON.stringify(process.argv.includes('--summary')
    ? { total: report.total, matched: report.matched, unmatched: report.unmatched, unchanged: report.unchanged }
    : report, null, 2))
  if (!apply) return

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `tv-ports-before-update-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(products, null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  const verifiedAt = new Date().toISOString()
  for (const { product, rule, ports } of matched) {
    const { error: updateError } = await db.from('products').update({
      ports,
      specs_source_url: rule.sourceUrl,
      specs_verified_at: verifiedAt,
    }).eq('id', product.id)
    if (updateError) throw new Error(`${product.name} の更新に失敗: ${updateError.message}`)
  }
  console.log(`${matched.length}件のテレビ端子仕様を更新しました（無変更 ${unmatched.length}件）`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
