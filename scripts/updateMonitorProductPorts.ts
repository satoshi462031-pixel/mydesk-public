import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Port } from '../src/types'
import { GADGET_PRESETS } from '../src/constants/gadgetPresets'
import { createAdminClient, loadEnv } from './importRakuten'

type PortSpec = {
  hdmi: number
  displayPort: number
  sourceUrl: string
}

const VERIFIED_REMOTE = new Map<string, PortSpec>([
  ['fa355299-796d-4117-b98a-68eaaeb79ec6', { hdmi: 1, displayPort: 0, sourceUrl: 'https://store.acer.com/ja-jp/acer-19-5-20e0qbi' }],
  ['47583b68-0c03-4470-887e-5d9445083216', { hdmi: 1, displayPort: 0, sourceUrl: 'https://www.aopen.com/JP_jp/products_info/22SB2Q_E/' }],
  ['d45d8bbe-eb7f-47f3-8468-9e1b9facd845', { hdmi: 1, displayPort: 0, sourceUrl: 'https://www.aopen.com/JP_jp/products_info/27SB2_E' }],
  ['747006fa-945b-4917-b933-4240b673c38d', { hdmi: 2, displayPort: 0, sourceUrl: 'https://www.benq.com/en-in/monitor/home/ma270u/spec.html' }],
  ['032350c2-5ae0-4ba6-9017-2b959be66734', { hdmi: 1, displayPort: 1, sourceUrl: 'https://www.benq.com/ja-jp/monitor/gaming/ex240n/spec.html' }],
  ['4aa59d54-fa0e-46fe-b59b-50a09347fd5f', { hdmi: 1, displayPort: 1, sourceUrl: 'https://www.dell.com/en-in/shop/dell-pro-24-adjustable-stand-monitor-e2425hsm/apd/210-bqzf/monitors-monitor-accessories' }],
  ['8df9e372-b33f-4169-b039-afb0916d7c41', { hdmi: 1, displayPort: 1, sourceUrl: 'https://www.dell.com/en-in/shop/dell-27-plus-qhd-usb-c-monitor-s2725dc/apd/210-bsrg/monitors-monitor-accessories' }],
  ['216d6195-20ba-471d-85d6-276ae24444a2', { hdmi: 1, displayPort: 1, sourceUrl: 'https://www.dell.com/en-us/shop/dell-pro-22-monitor-e2225hm/apd/210-bqhw/monitors-monitor-accessories' }],
  ['0bfbecd6-2b60-4829-b3a8-207263e8e9c4', { hdmi: 2, displayPort: 1, sourceUrl: 'https://jp.japannext.com/products/jn-ei238g180f/' }],
  ['57eb17e8-057c-48d5-9613-7921d32de60d', { hdmi: 1, displayPort: 1, sourceUrl: 'https://item.rakuten.co.jp/japannext/4589511169896/' }],
  ['28161a4e-1219-4e7a-98a2-1271a6397da3', { hdmi: 1, displayPort: 0, sourceUrl: 'https://www.philips.co.jp/c-p/241S9A_11/monitor-lcd-monitor' }],
  ['65e58e0f-368b-4e28-b942-ce460f535663', { hdmi: 1, displayPort: 0, sourceUrl: 'https://pixiogaming.jp/products/px246wave' }],
  ['0c9bbf4f-2f71-49ab-bf77-889cfff49951', { hdmi: 2, displayPort: 2, sourceUrl: 'https://pixiogaming.jp/products/pxc325' }],
  ['f1285331-9448-462d-b635-8335f20b2d7f', { hdmi: 2, displayPort: 2, sourceUrl: 'https://item.rakuten.co.jp/pixiogaming/px259p/' }],
  ['04b8166e-a8e0-4ebb-b278-a42d0f927e74', { hdmi: 2, displayPort: 1, sourceUrl: 'https://item.rakuten.co.jp/pixiogaming/px278wave/' }],
  ['e32a1718-89bd-4ea9-9473-1c3dbd8209a6', { hdmi: 2, displayPort: 1, sourceUrl: 'https://item.rakuten.co.jp/pixiogaming/px24qpro/' }],
  ['11578afa-3812-45f0-97c4-531ca3a6bb2e', { hdmi: 2, displayPort: 1, sourceUrl: 'https://item.rakuten.co.jp/pixiogaming/px248pp/' }],
  ['7e505a12-ee6b-4033-9779-4eeaf6d8f72a', { hdmi: 2, displayPort: 0, sourceUrl: 'https://pixiogaming.jp/products/px160wave' }],
  ['c30093c8-3988-49ee-9df3-0f0b57f9601a', { hdmi: 1, displayPort: 1, sourceUrl: 'https://www.mi.com/global/product/xiaomi-monitor-a24i-2026/specs/' }],
  ['34f5a077-1336-495d-8d7d-0174eab529b0', { hdmi: 1, displayPort: 1, sourceUrl: 'https://www.mi.com/jp/product/xiaomi-gaming-monitor-g24i-2026/specs/' }],
])

const VERIFIED_PRESETS = new Map<string, string>([
  ['Dell U2725QE', 'https://www.dell.com/en-us/shop/dell-ultrasharp-27-4k-thunderbolt-hub-monitor-u2725qe/apd/210-bqhr/monitors-monitor-accessories'],
  ['Dell UltraSharp U3225QE', 'https://www.dell.com/en-us/shop/dell-ultrasharp-32-monitor-u3225qe/apd/210-bqhs/monitors-monitor-accessories'],
  ['BenQ PD3225U', 'https://www.benq.com/ja-jp/monitor/creative-pro/pd3225u/spec.html'],
  ['Dell Alienware AW2725QF (27" 4K 180Hz)', 'https://www.dell.com/pt-br/shop/monitor-gamer-com-resolu%C3%A7%C3%A3o-dupla-4k-de-27-alienware-aw2725qf/apd/210-bnjj/monitores-e-acess%C3%B3rios'],
  ['iiyama ProLite XUB2792UHSU-B6', 'https://iiyama.com/gb_en/products/prolite-xub2792uhsu-b6/'],
])

function videoPorts(spec: PortSpec): Port[] {
  return [
    ...(spec.hdmi > 0 ? [{ id: 'hdmi-input', type: 'HDMI' as const, direction: 'input' as const, count: spec.hdmi, supportsVideo: true }] : []),
    ...(spec.displayPort > 0 ? [{ id: 'displayport-input', type: 'DisplayPort' as const, direction: 'input' as const, count: spec.displayPort, supportsVideo: true }] : []),
  ]
}

function countInput(ports: unknown, type: 'HDMI' | 'DisplayPort'): number {
  if (!Array.isArray(ports)) return 0
  return ports.reduce((sum, port) => {
    if (!port || typeof port !== 'object') return sum
    const candidate = port as Partial<Port>
    return candidate.type === type && candidate.direction === 'input' && typeof candidate.count === 'number'
      ? sum + candidate.count
      : sum
  }, 0)
}

async function main(): Promise<void> {
  loadEnv()
  const apply = process.argv.includes('--apply')
  const db = createAdminClient()
  const presetSpecs = GADGET_PRESETS
    .filter((preset) => preset.category === 'Monitor' && VERIFIED_PRESETS.has(preset.name))
    .map((preset) => ({ name: preset.name, ports: preset.ports, sourceUrl: VERIFIED_PRESETS.get(preset.name)! }))

  const ids = [...VERIFIED_REMOTE.keys()]
  const names = presetSpecs.map((preset) => preset.name)
  const { data, error } = await db
    .from('products')
    .select('id,name,category,ports,specs_source_url,specs_verified_at')
    .or(`id.in.(${ids.join(',')}),name.in.(${names.map((name) => `"${name.replaceAll('"', '\\"')}"`).join(',')})`)
  if (error) throw new Error(`更新対象の取得に失敗: ${error.message}`)

  const products = data ?? []
  const updates = products.map((product) => {
    const remote = VERIFIED_REMOTE.get(product.id)
    const preset = presetSpecs.find((candidate) => candidate.name === product.name)
    if (!remote && !preset) throw new Error(`仕様定義がありません: ${product.id}`)
    if (product.category !== 'Monitor') throw new Error(`Monitor以外が対象に含まれています: ${product.name}`)
    return {
      id: product.id,
      name: product.name,
      ports: remote ? videoPorts(remote) : preset!.ports,
      specs_source_url: remote?.sourceUrl ?? preset!.sourceUrl,
      specs_verified_at: new Date().toISOString(),
    }
  })

  const expected = VERIFIED_REMOTE.size + presetSpecs.length
  if (updates.length !== expected) throw new Error(`更新対象が不足しています: ${updates.length}/${expected}`)
  if (process.argv.includes('--verify')) {
    const mismatches = updates.filter((update) => {
      const stored = products.find((product) => product.id === update.id)
      return !stored
        || countInput(stored.ports, 'HDMI') !== countInput(update.ports, 'HDMI')
        || countInput(stored.ports, 'DisplayPort') !== countInput(update.ports, 'DisplayPort')
        || stored.specs_source_url !== update.specs_source_url
        || !stored.specs_verified_at
    })
    if (mismatches.length > 0) throw new Error(`検証不一致: ${mismatches.map((item) => item.name).join(', ')}`)
    console.log(`${updates.length}件のDB端子仕様を検証しました`)
    return
  }
  console.log(JSON.stringify(updates.map((update) => ({
    id: update.id,
    name: update.name,
    hdmi: update.ports.find((port) => port.type === 'HDMI' && port.direction === 'input')?.count ?? 0,
    displayPort: update.ports.find((port) => port.type === 'DisplayPort' && port.direction === 'input')?.count ?? 0,
    sourceUrl: update.specs_source_url,
  })), null, 2))
  if (!apply) {
    console.log(`dry-run: ${updates.length}件（書き込みなし）`)
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `monitor-ports-before-update-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(products, null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  for (const update of updates) {
    const { error: updateError } = await db.from('products').update({
      ports: update.ports,
      specs_source_url: update.specs_source_url,
      specs_verified_at: update.specs_verified_at,
    }).eq('id', update.id)
    if (updateError) throw new Error(`${update.name} の更新に失敗: ${updateError.message}`)
  }
  console.log(`${updates.length}件のモニター端子仕様を更新しました`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
