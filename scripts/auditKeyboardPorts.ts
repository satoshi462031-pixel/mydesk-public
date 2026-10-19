/**
 * キーボード商品の接続方式データを点検する（手元PCから実行する）
 *
 *   npm run audit:keyboard
 *
 * 件数だけでなく「予測変換で選んだときにアプリが何を復元するか」まで再現して確認する。
 * 登録（utils/gadgetFromProduct.ts）は ports からレシーバー／Bluetooth を探して接続方式を決め、
 * 保存時に buildGadgetPorts が組み立て直すので、往復して形が変わるデータは
 * ユーザーが触っていないのに保存で内容が変わる（= 商品DB側が間違っている）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Port } from '../src/types'
import { CATEGORY_PORT_CONFIG, initPortState } from '../src/constants/portFormConfig'
import { buildGadgetPorts } from '../src/utils/gadgetPorts'
import { createAdminClient, loadEnv } from './importRakuten'

type Row = {
  id: string
  name: string
  source: string | null
  ports: unknown
  specs_source_url: string | null
}

const isReceiverPort = (port: Port) =>
  port.type === 'USB_A' && port.direction === 'input' &&
  /レシーバー|ドングル|receiver|dongle|Unifying|LIGHTSPEED|Logi Bolt/i.test(port.label ?? '')

/** 登録（gadgetFromProduct）が商品の選択時に決める接続方式を再現する */
function restoredConnection(ports: Port[]): 'wired' | 'dongle' | 'wireless' {
  if (ports.some(isReceiverPort)) return 'dongle'
  return ports.some((port) => port.type === 'Bluetooth') ? 'wireless' : 'wired'
}

function portKey(port: Port): string {
  return `${port.type}/${port.direction}/${port.count}/${port.label ?? ''}/${port.directAttach ? 'direct' : ''}`
}

function signature(ports: Port[]): string {
  return [...ports].map(portKey).sort().join(' , ')
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  // Supabase の max-rows は 1000。終端を広げても切れるのでページングする
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id,name,source,ports,specs_source_url')
      .eq('category', 'Keyboard')
      .order('name')
      .range(from, from + 999)
    if (error) throw new Error(`キーボード商品の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  const withPorts = rows.filter((row) => Array.isArray(row.ports) && row.ports.length > 0)
  const byConnection: Record<string, number> = {}
  const roundTripMismatch: Array<{ id: string; name: string; stored: string; rebuilt: string }> = []
  const noConnection: Array<{ id: string; name: string }> = []

  for (const row of withPorts) {
    const ports = row.ports as Port[]
    const connection = restoredConnection(ports)
    byConnection[connection] = (byConnection[connection] ?? 0) + 1

    const hasConnectionPort = ports.some((port) =>
      port.type === 'Bluetooth' || (port.direction === 'input' && (port.type === 'USB_A' || port.type === 'USB_C')))
    if (!hasConnectionPort) noConnection.push({ id: row.id, name: row.name })

    const receiver = ports.find(isReceiverPort)
    const rebuilt = buildGadgetPorts({
      category: 'Keyboard',
      portState: initPortState(ports, CATEGORY_PORT_CONFIG.Keyboard ?? []),
      mouseConnType: 'wireless',
      periConnType: connection,
      receiverLabel: receiver?.label ?? '',
      receiverSupportsBluetooth: !!receiver && ports.some((port) => port.type === 'Bluetooth'),
      powerInput: 'none',
      charge: { usbC: 0, usbA: 0, wirelessCount: 0 },
      strip: { outlets: 0, usbC: 0, usbA: 0, grounded: false },
    })
    // 有線と無線を両方持つ商品は、保存時に選ばれていないほうの口が落ちる（フォームが1方式しか持てない）。
    // これは仕様なので、保存後に「DBに無い口が増えている」場合だけ商品DB側の誤りとして扱う
    const storedKeys = new Set(ports.map(portKey))
    if (rebuilt.some((port) => !storedKeys.has(portKey(port)))) {
      roundTripMismatch.push({ id: row.id, name: row.name, stored: signature(ports), rebuilt: signature(rebuilt) })
    }
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const outputPath = resolve(backupDir, `keyboard-port-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outputPath, JSON.stringify({ roundTripMismatch, noConnection }, null, 2))

  console.log(`キーボード商品: ${rows.length}件 / 接続方式あり: ${withPorts.length}件（${Math.round(withPorts.length / rows.length * 100)}%）`)
  console.log('復元される接続方式:', byConnection)
  console.log(`商品ページで確認済み: ${withPorts.filter((row) => row.specs_source_url).length}件`)
  console.log(`接続ポートを持たない: ${noConnection.length}件`)
  console.log(`保存で形が変わる（往復不一致）: ${roundTripMismatch.length}件`)
  for (const mismatch of roundTripMismatch.slice(0, 5)) {
    console.log(`  ${mismatch.name.slice(0, 50)}\n    DB   : ${mismatch.stored}\n    保存後: ${mismatch.rebuilt}`)
  }
  console.log(`詳細: ${outputPath}`)
  if (roundTripMismatch.length > 0 || noConnection.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
