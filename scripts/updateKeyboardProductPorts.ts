/**
 * researchKeyboardPorts.ts の判定結果を products.ports に反映する（手元PCから実行する）
 *
 *   npx tsx scripts/updateKeyboardProductPorts.ts                 # 書き込まずに件数と内訳だけ出す
 *   npx tsx scripts/updateKeyboardProductPorts.ts --apply         # 反映する（直前にバックアップを取る）
 *   npx tsx scripts/updateKeyboardProductPorts.ts --file .codex-backups/keyboard-port-research-....json
 *   npx tsx scripts/updateKeyboardProductPorts.ts --verify        # DBが判定結果どおりか確認する
 *
 * ここで入れる ports は buildGadgetPorts が作るものと同じ形にしてある。
 * 商品を選んで登録するとき gadgetFromProduct が接続方式（有線 / 2.4GHz / Bluetooth）を復元し、
 * ユーザーがそのまま保存しても差分が出ないようにするため。
 *
 * source='preset' の商品は触らない。gadgetPresets.ts が持つ手作業のポート定義のほうが正確で、
 * アプリは商品DBのポートを優先するため、上書きすると質が落ちる。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'
import type { KeyboardDecision, KeyboardResearch } from './researchKeyboardPorts'
import { connectionShape, isAccessoryName } from './researchKeyboardPorts'

type StoredProduct = {
  id: string
  name: string
  category: string | null
  source: string | null
  ports: unknown
  specs_source_url: string | null
}

function latestResearchPath(): string {
  const dir = resolve(process.cwd(), '.codex-backups')
  const files = readdirSync(dir)
    .filter((name) => name.startsWith('keyboard-port-research-') && name.endsWith('.json'))
    .sort()
  const latest = files.at(-1)
  if (!latest) throw new Error('研究結果が見つかりません。先に researchKeyboardPorts.ts を実行してください')
  return resolve(dir, latest)
}

/** buildGadgetPorts（src/utils/gadgetPorts.ts）の出力と同じ形にそろえる */
export function portsForDecision(decision: KeyboardDecision): Port[] {
  const ports: Port[] = []
  if (decision.hubUsbA > 0) {
    // ハブの口はフォーム側がラベル無しで作り直すので、ここでも付けない（保存で消える差分を作らない）
    ports.push({ id: 'kb_hub', type: 'USB_A', direction: 'output', count: decision.hubUsbA })
  }
  if (decision.modes.dongle) {
    // レシーバーはPCに直挿しするのでケーブルは要らない（directAttach）
    ports.push({ id: 'kb_conn', type: 'USB_A', direction: 'input', count: 1, label: '2.4GHzレシーバー', directAttach: true })
    if (decision.modes.bluetooth) {
      ports.push({ id: 'kb_conn_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 })
    }
  } else if (decision.modes.bluetooth) {
    ports.push({ id: 'kb_conn', type: 'Bluetooth', direction: 'bidirectional', count: 1 })
  }
  if (decision.modes.wired) {
    const type = decision.wiredConnector === 'USB_C' ? 'USB_C' : 'USB_A'
    ports.push({
      id: 'kb_wired',
      type,
      direction: 'input',
      count: 1,
      label: `有線接続 (${type === 'USB_C' ? 'USB-C' : 'USB-A'})`,
    })
  }
  return ports
}

function samePorts(a: unknown, b: Port[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false
  return a.every((port, index) => {
    if (!port || typeof port !== 'object') return false
    const stored = port as Partial<Port>
    const expected = b[index]
    return stored.type === expected.type
      && stored.direction === expected.direction
      && stored.count === expected.count
      && (stored.label ?? null) === (expected.label ?? null)
      && Boolean(stored.directAttach) === Boolean(expected.directAttach)
  })
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  loadEnv()
  const apply = process.argv.includes('--apply')
  const verify = process.argv.includes('--verify')
  const overwrite = process.argv.includes('--overwrite')
  // ページ全文から拾った判定は関連商品の記述を巻き込んでいることがある
  const strict = process.argv.includes('--strict')
  const researchPath = argValue('--file') ? resolve(process.cwd(), argValue('--file')!) : latestResearchPath()
  const research = JSON.parse(readFileSync(researchPath, 'utf8')) as KeyboardResearch
  console.log(`判定ファイル: ${researchPath}（${research.decided.length}件）`)

  const db = createAdminClient()
  const stored = new Map<string, StoredProduct>()
  const ids = research.decided.map((decision) => decision.id)
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await db
      .from('products')
      .select('id,name,category,source,ports,specs_source_url')
      .in('id', ids.slice(index, index + 200))
    if (error) throw new Error(`商品の取得に失敗: ${error.message}`)
    for (const product of (data ?? []) as StoredProduct[]) stored.set(product.id, product)
  }

  const updates: Array<{ decision: KeyboardDecision; product: StoredProduct; ports: Port[] }> = []
  const skipped: Record<string, number> = {}
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1 }

  for (const decision of research.decided) {
    const product = stored.get(decision.id)
    if (!product) { skip('missing'); continue }
    if (product.category !== 'Keyboard') { skip('not-keyboard'); continue }
    if (product.source === 'preset') { skip('preset'); continue }
    // 判定後に除外条件を足したときのため、書き込み直前にもう一度ふるいにかける
    if (isAccessoryName(product.name)) { skip('accessory'); continue }
    if (strict && decision.origin === 'page-full') { skip('page-full'); continue }
    const ports = portsForDecision(decision)
    if (ports.length === 0) { skip('no-ports'); continue }
    if (!overwrite && Array.isArray(product.ports) && product.ports.length > 0 && !samePorts(product.ports, ports)) {
      skip('already-has-ports')
      continue
    }
    if (samePorts(product.ports, ports)) { skip('unchanged'); continue }
    updates.push({ decision, product, ports })
  }

  const byShape: Record<string, number> = {}
  for (const update of updates) {
    const key = connectionShape(update.decision)
    byShape[key] = (byShape[key] ?? 0) + 1
  }
  console.log(`更新対象: ${updates.length}件`)
  console.log('接続方式の内訳:', byShape)
  console.log('対象外:', skipped)

  if (verify) {
    const mismatches = updates.filter((update) => !samePorts(update.product.ports, update.ports))
    console.log(mismatches.length === 0
      ? `${research.decided.length}件すべてDBに反映済みです`
      : `未反映: ${mismatches.length}件（例: ${mismatches.slice(0, 3).map((item) => item.product.name.slice(0, 40)).join(' / ')}）`)
    return
  }

  if (!apply) {
    for (const update of updates.slice(0, 10)) {
      console.log(`  [${connectionShape(update.decision)}] ${update.product.name.slice(0, 60)}`)
    }
    console.log('dry-run: 書き込みなし（--apply で反映）')
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `keyboard-ports-before-update-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(updates.map((update) => update.product), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  const verifiedAt = new Date().toISOString()
  let done = 0
  for (const update of updates) {
    // 商品ページを見て判断できたものだけ確認元を残す。名前から推定したものは空のままにして、
    // 後から「根拠を確認済みか」を区別できるようにする
    const payload: Record<string, unknown> = { ports: update.ports }
    if (update.decision.origin === 'page' && update.decision.sourceUrl) {
      payload.specs_source_url = update.decision.sourceUrl
      payload.specs_verified_at = verifiedAt
    }
    const { error } = await db.from('products').update(payload).eq('id', update.decision.id)
    if (error) throw new Error(`${update.product.name} の更新に失敗: ${error.message}`)
    done += 1
    if (done % 100 === 0) console.log(`  ${done}/${updates.length}`)
  }
  console.log(`${updates.length}件のキーボード接続方式を更新しました`)
}

// portsForDecision を他スクリプトから import しても走らないようにする
if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/updateKeyboardProductPorts.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
