/**
 * 商品DBの全 ordered pair × 全物理ケーブル型を監査する。
 *
 * 行数は商品数の二乗×ケーブル数になるため、組み合わせ自体は展開せず、
 * ポート構成が同じ商品を束ねて正確な件数だけを BigInt で集計する。
 * DBは読み取り専用。結果は docs/audits に Markdown と JSON で保存する。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CableType, Port } from '../src/types'
import {
  CABLE_SORT_ORDER,
  PORT_COMPATIBILITY,
  cableLabel,
  determineCableType,
  requiresPhysicalCable,
} from '../src/constants/portTypes'
import { createAdminClient, loadEnv } from './importRakuten'

type ProductRow = {
  id: string
  name: string
  category: string | null
  ports: unknown
  specs_source_url: string | null
}

type Direction = 'ab' | 'ba'
type Outcome = 'unknown' | 'incompatible' | 'ab' | 'ba' | 'both'

type Signature = {
  key: string
  ports: Port[]
  count: bigint
}

const physicalCableTypes = CABLE_SORT_ORDER.filter(requiresPhysicalCable)

function validPorts(value: unknown): Port[] {
  if (!Array.isArray(value)) return []
  return value.filter((port): port is Port => {
    if (!port || typeof port !== 'object') return false
    const candidate = port as Partial<Port>
    return typeof candidate.type === 'string' &&
      (candidate.direction === 'input' || candidate.direction === 'output' || candidate.direction === 'bidirectional') &&
      typeof candidate.count === 'number' && candidate.count > 0
  })
}

function canonicalPorts(ports: Port[]): Port[] {
  return [...ports]
    .map((port) => ({
      id: '',
      type: port.type,
      direction: port.direction,
      count: port.count,
      directAttach: Boolean(port.directAttach),
      supportsVideo: port.supportsVideo,
      supportsPowerDelivery: port.supportsPowerDelivery,
      supportsPoE: port.supportsPoE,
      supportsDisplayConversion: port.supportsDisplayConversion,
      powerAdapterIncluded: port.powerAdapterIncluded,
    }))
    .sort((a, b) =>
      a.type.localeCompare(b.type) ||
      a.direction.localeCompare(b.direction) ||
      a.count - b.count ||
      Number(a.directAttach) - Number(b.directAttach),
    )
}

function canOutput(port: Port): boolean {
  return port.direction === 'output' || port.direction === 'bidirectional'
}

function canInput(port: Port): boolean {
  return port.direction === 'input' || port.direction === 'bidirectional'
}

function compatible(from: Port, to: Port, cable: CableType): boolean {
  if (!canOutput(from) || !canInput(to)) return false
  if (!(PORT_COMPATIBILITY[from.type] ?? []).includes(to.type)) return false
  if (determineCableType(from.type, to.type) !== cable) return false
  if (
    (cable === 'USB_C_to_DisplayPort' || cable === 'USB_C_to_HDMI') &&
    from.supportsVideo !== true
  ) return false
  if (
    (cable === 'DisplayPort_to_HDMI' || cable === 'HDMI_to_DisplayPort') &&
    from.supportsDisplayConversion !== true
  ) return false
  if (cable === 'DCPower' && to.powerAdapterIncluded !== true) return false
  // 直挿し端子はケーブルを使わない。同じ端子型でも物理ケーブル監査から除外する。
  return !from.directAttach && !to.directAttach
}

function directionFor(a: Port[], b: Port[], cable: CableType): Direction[] {
  const directions: Direction[] = []
  if (a.some((from) => b.some((to) => compatible(from, to, cable)))) directions.push('ab')
  if (b.some((from) => a.some((to) => compatible(from, to, cable)))) directions.push('ba')
  return directions
}

function outcomeFor(a: Port[], b: Port[], cable: CableType): Outcome {
  if (a.length === 0 || b.length === 0) return 'unknown'
  const directions = directionFor(a, b, cable)
  if (directions.length === 2) return 'both'
  return directions[0] ?? 'incompatible'
}

function add(map: Map<string, bigint>, key: string, value: bigint): void {
  map.set(key, (map.get(key) ?? 0n) + value)
}

function format(value: bigint): string {
  return value.toLocaleString('ja-JP')
}

function percent(value: bigint, total: bigint): string {
  if (total === 0n) return '0.0000%'
  return `${(Number(value * 1_000_000n / total) / 10_000).toFixed(4)}%`
}

function stringifyBigInt(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2)
}

async function fetchAllProducts(): Promise<ProductRow[]> {
  const db = createAdminClient()
  const rows: ProductRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('products')
      .select('id,name,category,ports,specs_source_url')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`products ${from}件目からの取得に失敗: ${error.message}`)
    const page = (data ?? []) as ProductRow[]
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

async function main(): Promise<void> {
  loadEnv()
  const products = await fetchAllProducts()
  const bySignature = new Map<string, Signature>()
  const categoryStats = new Map<string, { total: bigint; withPorts: bigint; sourced: bigint }>()
  let withPorts = 0n
  let sourced = 0n

  for (const product of products) {
    const ports = canonicalPorts(validPorts(product.ports))
    const category = product.category ?? '(未分類)'
    const categoryStat = categoryStats.get(category) ?? { total: 0n, withPorts: 0n, sourced: 0n }
    categoryStat.total += 1n
    if (ports.length > 0) withPorts += 1n
    if (ports.length > 0) categoryStat.withPorts += 1n
    if (product.specs_source_url) {
      sourced += 1n
      categoryStat.sourced += 1n
    }
    categoryStats.set(category, categoryStat)
    const key = JSON.stringify(ports)
    const signature = bySignature.get(key)
    if (signature) signature.count += 1n
    else bySignature.set(key, { key, ports, count: 1n })
  }

  const signatures = [...bySignature.values()]
  const counts = new Map<string, bigint>()
  const cableCounts = new Map<CableType, Map<Outcome, bigint>>()
  for (const cable of physicalCableTypes) {
    cableCounts.set(cable, new Map<Outcome, bigint>())
  }

  for (const a of signatures) {
    for (const b of signatures) {
      const multiplicity = a.count * b.count
      for (const cable of physicalCableTypes) {
        const outcome = outcomeFor(a.ports, b.ports, cable)
        add(counts, outcome, multiplicity)
        add(cableCounts.get(cable)!, outcome, multiplicity)
      }
    }
  }

  const productCount = BigInt(products.length)
  const orderedPairs = productCount * productCount
  const totalChecks = orderedPairs * BigInt(physicalCableTypes.length)
  const knownOrderedPairs = withPorts * withPorts
  const knownChecks = knownOrderedPairs * BigInt(physicalCableTypes.length)
  const outcomeRows = (['both', 'ab', 'ba', 'incompatible', 'unknown'] as Outcome[]).map((outcome) => ({
    outcome,
    count: counts.get(outcome) ?? 0n,
    ratio: percent(counts.get(outcome) ?? 0n, totalChecks),
  }))
  const perCable = physicalCableTypes.map((cable) => {
    const values = cableCounts.get(cable)!
    const both = values.get('both') ?? 0n
    const ab = values.get('ab') ?? 0n
    const ba = values.get('ba') ?? 0n
    return {
      cable,
      label: cableLabel(cable, 'ja'),
      connectable: both + ab + ba,
      both,
      ab,
      ba,
      incompatible: values.get('incompatible') ?? 0n,
      unknown: values.get('unknown') ?? 0n,
    }
  })
  const connectableChecks = perCable.reduce((sum, row) => sum + row.connectable, 0n)
  const zeroConnectionCables = perCable.filter((row) => row.connectable === 0n)

  const generatedAt = new Date().toISOString()
  const categories = [...categoryStats.entries()]
    .map(([category, stat]) => ({ category, ...stat, coverage: percent(stat.withPorts, stat.total) }))
    .sort((a, b) => Number(b.total - a.total) || a.category.localeCompare(b.category))
  const result = {
    generatedAt,
    definition: {
      pair: 'ordered pair（同一商品同士を含む）',
      cableTypes: physicalCableTypes,
      outcome: {
        both: 'A→BとB→Aの双方で、信号方向と端子互換性が成立',
        ab: 'A→Bのみ成立',
        ba: 'B→Aのみ成立',
        incompatible: '両商品のポートは判明しているが、このケーブルでは成立しない',
        unknown: '片方以上の商品にポート情報がなく判定不能',
      },
    },
    products: { total: productCount, withPorts, withoutPorts: productCount - withPorts, sourced },
    signatures: BigInt(signatures.length),
    orderedPairs,
    knownOrderedPairs,
    totalChecks,
    knownChecks,
    connectableChecks,
    connectableKnownCheckRatio: percent(connectableChecks, knownChecks),
    outcomes: outcomeRows,
    perCable,
    zeroConnectionCables: zeroConnectionCables.map(({ cable, label }) => ({ cable, label })),
    categories,
  }

  const outputDir = resolve(process.cwd(), 'docs', 'audits')
  mkdirSync(outputDir, { recursive: true })
  const jsonPath = resolve(outputDir, 'product-cable-pair-audit.json')
  const markdownPath = resolve(outputDir, 'product-cable-pair-audit.md')
  writeFileSync(jsonPath, stringifyBigInt(result))

  const cableTable = perCable.map((row) =>
    `| ${row.label} | ${format(row.connectable)} | ${format(row.both)} | ${format(row.ab)} | ${format(row.ba)} | ${format(row.incompatible)} | ${format(row.unknown)} |`,
  ).join('\n')
  const outcomeTable = outcomeRows.map((row) =>
    `| ${row.outcome} | ${format(row.count)} | ${row.ratio} |`,
  ).join('\n')
  const categoryTable = categories.map((row) =>
    `| ${row.category} | ${format(row.total)} | ${format(row.withPorts)} | ${row.coverage} | ${format(row.sourced)} |`,
  ).join('\n')
  const markdown = `# 全商品 × 全商品 × 全ケーブル 接続監査\n\n` +
    `生成日時: ${generatedAt}\n\n` +
    `## 結果\n\n` +
    `- 商品: ${format(productCount)}件（ポート情報あり ${format(withPorts)}件 / なし ${format(productCount - withPorts)}件）\n` +
    `- 仕様ページの根拠URLあり: ${format(sourced)}件\n` +
    `- ordered pair: ${format(orderedPairs)}組（同一商品同士を含む）\n` +
    `- ポート既知商品のordered pair: ${format(knownOrderedPairs)}組\n` +
    `- 物理ケーブル型: ${physicalCableTypes.length}種類\n` +
    `- 検査総数: ${format(totalChecks)}件\n` +
    `- ポート既知商品の検査数: ${format(knownChecks)}件\n` +
    `- 成立: ${format(connectableChecks)}件（ポート既知検査の ${percent(connectableChecks, knownChecks)}）\n` +
    `- 異なるポート構成: ${format(BigInt(signatures.length))}種類（同一構成を束ねて全件を正確に集計）\n\n` +
    `| 判定 | 件数 | 全検査比 |\n|---|---:|---:|\n${outcomeTable}\n\n` +
    `## ケーブル別\n\n` +
    `「成立」はポート形状・信号方向・確認済み能力・アプリの互換表が一致する組み合わせであり、USB世代、PD電力、映像帯域などの上限までは保証しない。\n\n` +
    `| ケーブル | 成立計 | 双方向 | A→Bのみ | B→Aのみ | 不成立 | 未調査 |\n|---|---:|---:|---:|---:|---:|---:|\n${cableTable}\n\n` +
    `### 成立0件のケーブル型\n\n` +
    `${zeroConnectionCables.map((row) => `- ${row.label}（${row.cable}）`).join('\n')}\n\n` +
    `0件は現実世界で接続不能という意味ではない。現在の商品DBに対応する入出力ポートの組がない、または互換判定からそのケーブル型へ到達しないことを示す。\n\n` +
    `## カテゴリ別データ充足率\n\n` +
    `| カテゴリ | 商品 | ポートあり | 充足率 | 根拠URLあり |\n|---|---:|---:|---:|---:|\n${categoryTable}\n\n` +
    `## 判定上の重要な制約\n\n` +
    `- ポート情報なしの商品を「不成立」にしていない。片方でも未登録なら未調査。\n` +
    `- USB-C/Thunderbolt映像は supportsVideo=true の製品だけを成立とする。USB世代・帯域・PD電力は引き続き個別確認が必要。\n` +
    `- DC電源は適合アダプター確認済みの入力だけを成立とする。電圧・極性・プラグは接続前に個別確認する。\n` +
    `- DP↔HDMIなどの方向性変換は supportsDisplayConversion=true の出力だけを成立とする。\n` +
    `- 3.5mm/6.3mm/RCA/XLRは、端子形状だけでライン、マイク、ヘッドホン、バランス/アンバランス、ファンタム電源を完全判定できない。\n` +
    `- 「成立」は機器が期待する機能をすべて得る意味ではない。充電のみ、USB 2.0速度、映像のみなどに縮退する可能性がある。\n\n` +
    `## 一次資料\n\n` +
    `- [USB-IF: USB Type-C language and packaging guidelines](https://www.usb.org/sites/default/files/usb_type-c_language_product_and_packaging_guidelines_20230320.pdf) — USB-CはUSB 3.2、USB4、USB PDと同義ではなく、各機能の実装は必須ではない。\n` +
    `- [USB-IF: Cables and Connectors](https://www.usb.org/cable_connector) — ケーブルごとにデータ速度・電力能力が異なり、認証ケーブルも接続機器の能力を増やさない。\n` +
    `- [HDMI LA: HDMI Cable Power](https://www.hdmi.org/spec2sub/cablepower) — アクティブHDMIケーブルはSource/Sinkの向きがあり、逆接続では動作しない。\n` +
    `- [VESA: DisplayPort active cables](https://vesa.org/featured-articles/vesa-expands-displayport-standard-to-support-active-cables/) — アクティブDisplayPortケーブルは方向性があり、Source/Sinkを正しく接続する必要がある。\n\n` +
    `## 再実行\n\n` +
    `\`npm run audit:product-cable-pairs\`\n`
  writeFileSync(markdownPath, markdown)

  console.log(`商品 ${format(productCount)}件 / ケーブル ${physicalCableTypes.length}種類 / 検査 ${format(totalChecks)}件`)
  console.log(`ポートあり ${format(withPorts)}件 / なし ${format(productCount - withPorts)}件 / 構成 ${signatures.length}種類`)
  console.log(`結果: ${markdownPath}`)
  console.log(`詳細: ${jsonPath}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
