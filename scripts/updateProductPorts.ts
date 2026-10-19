/**
 * researchProductPorts.ts の判定結果を products.ports に反映する（手元PCから実行する）
 *
 *   npx tsx scripts/updateProductPorts.ts                      # 最新の判定ファイルで dry-run
 *   npx tsx scripts/updateProductPorts.ts --group b1 --apply    # 反映する（直前にバックアップ）
 *   npx tsx scripts/updateProductPorts.ts --file .codex-backups/product-port-research-a-....json
 *   npx tsx scripts/updateProductPorts.ts --group b1 --verify   # DBが判定どおりか確認する
 *
 * 触らないもの:
 *   - source='preset' の商品。gadgetPresets.ts の手作業のポート定義のほうが正確で、
 *     アプリは商品DBのポートを優先するため上書きすると質が落ちる
 *   - すでに ports が入っている商品（--overwrite を付けたときだけ上書き）
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'
import { wouldGrowOnSave } from './productPortRules'
import type { ProductPortDecision, ProductPortResearch } from './researchProductPorts'

type StoredProduct = {
  id: string
  name: string
  category: string | null
  source: string | null
  ports: unknown
}

function latestResearchPath(group: string | undefined): string {
  const dir = resolve(process.cwd(), '.codex-backups')
  const prefix = group ? `product-port-research-${group}-` : 'product-port-research-'
  // ファイル名の文字列順ではなく更新時刻で選ぶ。カテゴリ名を含むファイル名だと
  // 大文字小文字の並びで古いファイルが「最新」になる（実際に b3 を掴んで0件更新になった）
  const files = readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort((a, b) => statSync(resolve(dir, a)).mtimeMs - statSync(resolve(dir, b)).mtimeMs)
  const latest = files.at(-1)
  if (!latest) throw new Error('判定ファイルが見つかりません。先に researchProductPorts.ts を実行してください')
  return resolve(dir, latest)
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

function shape(decision: ProductPortDecision): string {
  return decision.ports
    .map((port) => `${port.type}${port.direction === 'output' ? '↑' : port.direction === 'input' ? '↓' : '↔'}${port.count}`)
    .join(' ')
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
  // ページ由来の判定は関連商品の記述を巻き込んでいることがある
  const strict = process.argv.includes('--strict')
  const researchPath = argValue('--file')
    ? resolve(process.cwd(), argValue('--file')!)
    : latestResearchPath(argValue('--group'))
  const research = JSON.parse(readFileSync(researchPath, 'utf8')) as ProductPortResearch
  console.log(`判定ファイル: ${researchPath}（${research.decided.length}件 / ${research.categories.join(', ')}）`)

  const db = createAdminClient()
  const stored = new Map<string, StoredProduct>()
  const ids = research.decided.map((decision) => decision.id)
  for (let index = 0; index < ids.length; index += 200) {
    const { data, error } = await db
      .from('products')
      .select('id,name,category,source,ports')
      .in('id', ids.slice(index, index + 200))
    if (error) throw new Error(`商品の取得に失敗: ${error.message}`)
    for (const product of (data ?? []) as StoredProduct[]) stored.set(product.id, product)
  }

  const updates: Array<{ decision: ProductPortDecision; product: StoredProduct }> = []
  const skipped: Record<string, number> = {}
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1 }

  for (const decision of research.decided) {
    const product = stored.get(decision.id)
    if (!product) { skip('missing'); continue }
    if (product.category !== decision.category) { skip('category-changed'); continue }
    if (product.source === 'preset') { skip('preset'); continue }
    if (strict && decision.origin === 'page') { skip('page'); continue }
    if (decision.ports.length === 0) { skip('no-ports'); continue }
    // 保存したら口が増える構成は書き込まない（図に存在しないケーブルが出る）。
    // 判定側にもガードがあるが、古い判定ファイルを流し込む経路のためここでも見る
    if (wouldGrowOnSave(decision.category, decision.ports)) { skip('grows-on-save'); continue }
    if (samePorts(product.ports, decision.ports)) { skip('unchanged'); continue }
    if (!overwrite && Array.isArray(product.ports) && product.ports.length > 0) { skip('already-has-ports'); continue }
    updates.push({ decision, product })
  }

  const byCategory: Record<string, number> = {}
  for (const update of updates) {
    byCategory[update.decision.category] = (byCategory[update.decision.category] ?? 0) + 1
  }
  console.log(`更新対象: ${updates.length}件`)
  console.table(byCategory)
  console.log('対象外:', skipped)

  if (verify) {
    const pending = updates.length
    console.log(pending === 0 ? '判定結果はすべてDBに反映済みです' : `未反映: ${pending}件`)
    return
  }

  if (!apply) {
    for (const update of updates.slice(0, 10)) {
      console.log(`  [${update.decision.category}] ${update.product.name.slice(0, 52)}\n      ${shape(update.decision)}`)
    }
    console.log('dry-run: 書き込みなし（--apply で反映）')
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `product-ports-before-update-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(updates.map((update) => update.product), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  const verifiedAt = new Date().toISOString()
  let done = 0
  for (const update of updates) {
    // 商品ページを見て判断できたものだけ確認元を残す。名前から推定したものは空のままにして、
    // 後から根拠の強さを区別できるようにする
    const payload: Record<string, unknown> = { ports: update.decision.ports }
    if (update.decision.origin === 'page' && update.decision.sourceUrl) {
      payload.specs_source_url = update.decision.sourceUrl
      payload.specs_verified_at = verifiedAt
    }
    const { error } = await db.from('products').update(payload).eq('id', update.decision.id)
    if (error) throw new Error(`${update.product.name} の更新に失敗: ${error.message}`)
    done += 1
    if (done % 200 === 0) console.log(`  ${done}/${updates.length}`)
  }
  console.log(`${updates.length}件のポート構成を更新しました`)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/updateProductPorts.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
