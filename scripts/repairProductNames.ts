/**
 * 商品DBの名前へ sanitizeProductName を当て直す（手元PCから実行する）
 *
 *   npx tsx scripts/repairProductNames.ts            # 差分を出すだけ
 *   npx tsx scripts/repairProductNames.ts --apply    # 実際に書き込む
 *
 * 取り込み時の正規化ルールを足しても、既に入っている行は古いままになる。
 * ここは「今のルールなら何になるか」を全行へ当てて、変わる行だけを更新する。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'
import { sanitizeProductName } from '../src/utils/productName'

type Row = { id: string; name: string; category: string | null; source: string | null }

const APPLY = process.argv.includes('--apply')

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id,name,category,source')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  // 手で整えたプリセット由来の名前は触らない。楽天取り込みの行だけが対象
  const targets = rows.filter((row) => row.source !== 'preset')
  const changes = targets
    .map((row) => ({ row, next: sanitizeProductName(row.name) }))
    .filter(({ row, next }) => next && next !== row.name)

  // 短くなりすぎる行は、販促語の判定が本体名を巻き込んでいる可能性がある。
  // 黙って潰さず、手で見るために分けて出す
  const shrunk = changes.filter(({ row, next }) => [...next].length < [...row.name].length * 0.4)

  // products.name には一意制約がある。販促語を落とした結果、別の行と同じ名前になる
  // （＝実質重複の商品）ことがあり、そのまま更新すると途中で落ちる。
  // 名前を寄せるかは商品の統合の判断になるので、ここでは触らずに一覧へ出す
  const idsByName = new Map<string, string[]>()
  for (const row of rows) idsByName.set(row.name, [...(idsByName.get(row.name) ?? []), row.id])
  const nextCount = new Map<string, number>()
  for (const change of changes) nextCount.set(change.next, (nextCount.get(change.next) ?? 0) + 1)
  const clashing = changes.filter(({ row, next }) =>
    (idsByName.get(next) ?? []).some((id) => id !== row.id) || (nextCount.get(next) ?? 0) > 1)

  const safe = changes.filter((change) => !shrunk.includes(change) && !clashing.includes(change))

  console.log(`対象: ${targets.length}件（preset 由来 ${rows.length - targets.length}件は除外）`)
  console.log(`名前が変わる: ${changes.length}件`)
  console.log(`  更新する: ${safe.length}件 / 要確認（6割以上短くなる）: ${shrunk.length}件 / 名前が衝突: ${clashing.length}件`)
  for (const { row, next } of safe.slice(0, 10)) {
    console.log(`  [${row.category}]`)
    console.log(`    - ${row.name.slice(0, 72)}`)
    console.log(`    + ${next.slice(0, 72)}`)
  }
  for (const { row, next } of shrunk.slice(0, 10)) {
    console.log(`  ★要確認 [${row.category}]`)
    console.log(`    - ${row.name.slice(0, 72)}`)
    console.log(`    + ${next.slice(0, 72)}`)
  }
  for (const { row, next } of clashing) {
    console.log(`  ★名前が衝突 [${row.category}]`)
    console.log(`    - ${row.name.slice(0, 72)}`)
    console.log(`    + ${next.slice(0, 72)}`)
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const outputPath = resolve(backupDir, `product-name-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outputPath, JSON.stringify({
    safe: safe.map(({ row, next }) => ({ id: row.id, before: row.name, after: next })),
    shrunk: shrunk.map(({ row, next }) => ({ id: row.id, before: row.name, after: next })),
    clashing: clashing.map(({ row, next }) => ({ id: row.id, before: row.name, after: next })),
  }, null, 2))
  console.log(`\n差分: ${outputPath}`)

  if (!APPLY) {
    console.log('--apply を付けると書き込む（要確認・衝突の行は書き込まない）')
    return
  }
  let done = 0
  for (const { row, next } of safe) {
    const { error } = await db.from('products').update({ name: next }).eq('id', row.id)
    if (error) throw new Error(`${row.id} の更新に失敗: ${error.message}`)
    done += 1
    if (done % 100 === 0) console.log(`  ${done}/${safe.length}`)
  }
  console.log(`更新しました: ${done}件`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
