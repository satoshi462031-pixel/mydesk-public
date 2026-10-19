/**
 * 根拠のないカテゴリ既定値で作られた products.ports を安全側へ戻し、
 * 公式仕様を確認した機種だけを確定値で上書きする。
 *
 *   npx tsx scripts/repairLowConfidenceProductPorts.ts          # dry-run
 *   npx tsx scripts/repairLowConfidenceProductPorts.ts --apply  # バックアップ後に反映
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GadgetCategory, Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'
import { inferProductPorts } from './researchProductPorts'

type Product = {
  id: string
  name: string
  description: string | null
  category: GadgetCategory
  source: string | null
  ports: unknown
  specs_source_url: string | null
  specs_verified_at: string | null
}

type Patch = {
  ports: Port[] | null
  specs_source_url: string | null
  specs_verified_at: string | null
}

type Update = { product: Product; patch: Patch; reason: string }

const LOW_CONFIDENCE_CATEGORIES = new Set<GadgetCategory>([
  'Router', 'NetworkSwitch', 'Projector', 'CaptureDevice', 'Printer',
])

const MARKETPLACE_HOSTS = /(?:^|\.)(?:rakuten\.co\.jp|amazon\.|yahoo\.co\.jp|yodobashi\.com|biccamera\.com|ksdenki\.com|yamada-denki)/i

const p = (id: string, type: Port['type'], direction: Port['direction'], count = 1, extra: Partial<Port> = {}): Port =>
  ({ id, type, direction, count, ...extra })

type VerifiedRule = {
  pattern: RegExp
  category: GadgetCategory
  sourceUrl: string
  ports: Port[]
  reason: string
}

const VERIFIED_RULES: VerifiedRule[] = [
  {
    pattern: /BSW300MBK/i,
    category: 'Webcam',
    sourceUrl: 'https://www.buffalo.jp/product/detail/bsw300mbk.html',
    ports: [p('p1', 'USB_A', 'input', 1, { label: '有線接続 (USB-A)' })],
    reason: 'BUFFALO公式: USB 2.0 Type-A、Bluetooth非搭載',
  },
  {
    pattern: /RTX1220/i,
    category: 'Router',
    sourceUrl: 'https://network.yamaha.com/products/routers/rtx1220/spec',
    ports: [
      p('p1', 'Ethernet', 'input', 1, { label: 'WAN' }),
      p('p2', 'Ethernet', 'output', 9, { label: 'LAN' }),
      p('p3', 'USB_A', 'output'),
      p('p4', 'Power', 'input', 1, { label: '給電 (コンセント)' }),
    ],
    reason: 'YAMAHA公式: Ethernet計10口、USB-A 1口、Wi-Fi非搭載',
  },
  {
    pattern: /RTX830/i,
    category: 'Router',
    sourceUrl: 'https://network.yamaha.com/products/routers/rtx830/spec',
    ports: [
      p('p1', 'Ethernet', 'input', 1, { label: 'WAN' }),
      p('p2', 'Ethernet', 'output', 4, { label: 'LAN' }),
      p('p3', 'USB_A', 'output'),
      p('p4', 'Power', 'input', 1, { label: '給電 (コンセント)' }),
    ],
    reason: 'YAMAHA公式: WAN 1口、LAN 4口、USB-A 1口、Wi-Fi非搭載',
  },
  {
    pattern: /NVR510/i,
    category: 'Router',
    sourceUrl: 'https://network.yamaha.com/products/routers/nvr510/spec',
    ports: [
      p('p1', 'Ethernet', 'input', 1, { label: 'WAN' }),
      p('p2', 'Ethernet', 'output', 4, { label: 'LAN' }),
      p('p3', 'USB_A', 'output'),
      p('p4', 'Power', 'input', 1, { label: '給電 (コンセント)' }),
    ],
    reason: 'YAMAHA公式: WAN 1口、LAN 4口、USB-A 1口、Wi-Fi非搭載',
  },
  {
    pattern: /BBR-?4HG/i,
    category: 'Router',
    sourceUrl: 'https://www.buffalo.jp/product/detail/bbr-4hg.html',
    ports: [
      p('p1', 'Ethernet', 'input', 1, { label: 'WAN' }),
      p('p2', 'Ethernet', 'output', 4, { label: 'LAN' }),
      p('p3', 'Power', 'input', 1, { label: '給電 (コンセント)' }),
    ],
    reason: 'BUFFALO公式: 有線WAN 1口、LAN 4口、Wi-Fi非搭載',
  },
  {
    pattern: /BHR-?4GRV2/i,
    category: 'Router',
    sourceUrl: 'https://www.buffalo.jp/product/detail/bhr-4grv2.html',
    ports: [
      p('p1', 'Ethernet', 'input', 1, { label: 'WAN' }),
      p('p2', 'Ethernet', 'output', 4, { label: 'LAN' }),
      p('p3', 'Power', 'input', 1, { label: '給電 (コンセント)' }),
    ],
    reason: 'BUFFALO公式: 有線WAN 1口、LAN 4口、Wi-Fi非搭載',
  },
  {
    pattern: /27GR95QE/i,
    category: 'Monitor',
    sourceUrl: 'https://www.lg.com/jp/monitors/gaming-monitors/27gr95qe-b/',
    ports: [
      p('p1', 'HDMI', 'input', 2, { supportsVideo: true }),
      p('p2', 'DisplayPort', 'input', 1, { supportsVideo: true }),
      p('p3', 'USB_B', 'input', 1, { label: 'USBアップストリーム' }),
      p('p4', 'USB_A', 'output', 2),
      p('p5', 'Audio3_5mm', 'output'),
      p('p6', 'OpticalAudio', 'output'),
    ],
    reason: 'LG公式仕様で映像・USB・音声端子を確認',
  },
  {
    pattern: /(?:Brio|BRIO)\s*500|C940(?:GR|OW|RO)/i,
    category: 'Webcam',
    sourceUrl: 'https://www.logitech.com/en-qa/products/webcams/brio-500-webcam.html',
    ports: [p('p1', 'USB_C', 'input', 1, { label: '有線接続 (USB-C)' })],
    reason: 'Logicool公式: 固定USB-Cケーブル',
  },
  {
    pattern: /BlackWidow V4 Pro(?!\s*75)/i,
    category: 'Keyboard',
    sourceUrl: 'https://www.razer.com/gaming-keyboards/razer-blackwidow-v4-pro?page=tech-specs',
    ports: [
      p('p1', 'USB_C', 'input', 1, { label: '有線接続 (USB-C)' }),
      p('p2', 'USB_A', 'output', 1, { label: 'USB 2.0 パススルー' }),
    ],
    reason: 'Razer公式: USB-C有線接続、USB 2.0パススルー',
  },
  {
    pattern: /MINISFORUM AI X1 Pro/i,
    category: 'PC',
    sourceUrl: 'https://store.minisforum.com/products/minisforum-ai-x1-pro-370-mini-pc',
    ports: [
      p('p1', 'USB_C', 'output', 2, { label: 'USB4', supportsVideo: true }),
      p('p2', 'USB_A', 'output', 3),
      p('p3', 'HDMI', 'output', 1, { supportsVideo: true }),
      p('p4', 'DisplayPort', 'output', 1, { supportsVideo: true }),
      p('p5', 'Ethernet', 'input', 2),
      p('p6', 'Audio3_5mm', 'output', 1),
      p('p7', 'SDCard', 'input', 1),
    ],
    reason: 'MINISFORUM公式仕様でI/Oを確認',
  },
]

function isLowConfidence(product: Product): boolean {
  if (!LOW_CONFIDENCE_CATEGORIES.has(product.category)) return false
  if (product.source === 'preset') return false
  if (!Array.isArray(product.ports) || product.ports.length === 0) return false
  if (!product.specs_source_url) return true
  try {
    return MARKETPLACE_HOSTS.test(new URL(product.specs_source_url).hostname)
  } catch {
    return true
  }
}

function samePatch(product: Product, patch: Patch): boolean {
  const samePorts = product.ports === null && patch.ports === null
    || (Array.isArray(product.ports) && Array.isArray(patch.ports)
      && product.ports.length === patch.ports.length
      && product.ports.every((raw, index) => {
        const stored = raw as Partial<Port>
        const expected = patch.ports![index]
        return stored.id === expected.id
          && stored.type === expected.type
          && stored.direction === expected.direction
          && stored.count === expected.count
          && (stored.label ?? null) === (expected.label ?? null)
          && Boolean(stored.supportsVideo) === Boolean(expected.supportsVideo)
          && Boolean(stored.supportsPowerDelivery) === Boolean(expected.supportsPowerDelivery)
          && Boolean(stored.directAttach) === Boolean(expected.directAttach)
      }))
  return samePorts
    && product.specs_source_url === patch.specs_source_url
    && (patch.specs_source_url ? !!product.specs_verified_at : product.specs_verified_at === null)
}

async function main(): Promise<void> {
  loadEnv()
  const apply = process.argv.includes('--apply')
  const db = createAdminClient()
  const rows: Product[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products')
      .select('id,name,description,category,source,ports,specs_source_url,specs_verified_at')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`商品の取得に失敗: ${error.message}`)
    const page = (data ?? []) as Product[]
    rows.push(...page)
    if (page.length < 1000) break
  }

  const now = new Date().toISOString()
  const updates = new Map<string, Update>()
  for (const product of rows.filter(isLowConfidence)) {
    const inferred = inferProductPorts(product.category, `${product.name} ${product.description ?? ''}`)
    updates.set(product.id, {
      product,
      patch: { ports: inferred.ok ? inferred.ports : null, specs_source_url: null, specs_verified_at: null },
      reason: inferred.ok ? '商品名・説明に明記された端子だけで再構成' : '根拠のないカテゴリ既定値を削除',
    })
  }

  for (const product of rows) {
    const rule = VERIFIED_RULES.find((candidate) => candidate.category === product.category && candidate.pattern.test(product.name))
    if (!rule) continue
    updates.set(product.id, {
      product,
      patch: { ports: rule.ports, specs_source_url: rule.sourceUrl, specs_verified_at: now },
      reason: rule.reason,
    })
  }

  for (const [id, update] of updates) {
    if (samePatch(update.product, update.patch)) updates.delete(id)
  }
  const list = [...updates.values()]
  const summary: Record<string, number> = {}
  for (const update of list) {
    const key = `${update.product.category}: ${update.reason}`
    summary[key] = (summary[key] ?? 0) + 1
  }
  console.log(`更新対象: ${list.length}件`)
  console.table(summary)
  for (const update of list.slice(0, 30)) console.log(`[${update.product.category}] ${update.product.name}\n  ${update.reason}`)
  if (!apply) {
    console.log('dry-run: 書き込みなし（--apply で反映）')
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = now.replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `low-confidence-product-ports-before-repair-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(list.map(({ product, reason }) => ({ ...product, reason })), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  let done = 0
  for (const update of list) {
    const { error } = await db.from('products').update(update.patch).eq('id', update.product.id)
    if (error) throw new Error(`${update.product.name} の更新に失敗: ${error.message}`)
    done += 1
    if (done % 100 === 0) console.log(`  ${done}/${list.length}`)
  }
  console.log(`${done}件を修正しました`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
