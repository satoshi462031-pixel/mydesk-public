/**
 * 商品DBの名前を「ブランド名 + 商品名」だけに詰める（手元PCから実行する）
 *
 *   npx tsx scripts/summarizeProductNames.ts            # 差分を出すだけ
 *   npx tsx scripts/summarizeProductNames.ts --apply    # 実際に書き込む
 *
 * sanitizeProductName（販促語の除去）を通した後でも、楽天の名前は
 * 「カテゴリ語 + 製品名 + 型番 + 仕様の羅列」のままで予測変換の候補として読めない。
 * ここは summarizeProductName を当てて、識別に要らない語を落とす。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'
import { summarizeProductName } from '../src/utils/productName'

type Row = { id: string; name: string; brand: string | null; category: string | null; source: string | null }

const APPLY = process.argv.includes('--apply')
const charLength = (value: string) => [...value].length

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()

  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id,name,brand,category,source')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  // 手で整えたプリセット由来の名前は触らない
  const targets = rows.filter((row) => row.source !== 'preset')
  const changes = targets
    .map((row) => ({ row, next: summarizeProductName(row.name, row.brand ?? undefined) }))
    .filter(({ row, next }) => next && next !== row.name)

  // ブランド名しか残らなかった行は、製品名まで落としている疑いがある
  const brandOnly = changes.filter(({ row, next }) =>
    !!row.brand && next.trim().toLowerCase() === row.brand.trim().toLowerCase())

  // 詰め過ぎ（2割未満まで縮む）は本体名を巻き込んでいる可能性が高い
  const shrunk = changes.filter((change) =>
    !brandOnly.includes(change) && charLength(change.next) < charLength(change.row.name) * 0.2)

  // products.name には一意制約がある。詰めた結果ぶつかる行は色・容量違いなどの
  // 実質重複で、統合するかの判断が要る。ここでは触らず一覧に出す
  const idsByName = new Map<string, string[]>()
  for (const row of rows) idsByName.set(row.name, [...(idsByName.get(row.name) ?? []), row.id])
  const nextCount = new Map<string, number>()
  for (const change of changes) nextCount.set(change.next, (nextCount.get(change.next) ?? 0) + 1)
  const clashing = changes.filter(({ row, next }) =>
    (idsByName.get(next) ?? []).some((id) => id !== row.id) || (nextCount.get(next) ?? 0) > 1)

  const flagged = new Set([...brandOnly, ...shrunk, ...clashing])
  const safe = changes.filter((change) => !flagged.has(change))

  const before = targets.reduce((sum, row) => sum + charLength(row.name), 0) / targets.length
  const after = changes.reduce((sum, c) => sum + charLength(c.next), 0) / Math.max(changes.length, 1)

  console.log(`対象: ${targets.length}件（preset 由来 ${rows.length - targets.length}件は除外）`)
  console.log(`名前が変わる: ${changes.length}件`)
  console.log(`  更新する: ${safe.length}件 / ブランド名だけになる: ${brandOnly.length}件 / 詰め過ぎ: ${shrunk.length}件 / 名前が衝突: ${clashing.length}件`)
  console.log(`平均の長さ: ${before.toFixed(1)}文字 → 変わる行の平均 ${after.toFixed(1)}文字`)

  const show = (title: string, list: typeof changes, limit: number) => {
    if (list.length === 0) return
    console.log(`\n── ${title}（${list.length}件、先頭${Math.min(limit, list.length)}件）`)
    for (const { row, next } of list.slice(0, limit)) {
      console.log(`  [${row.category ?? '-'}] brand=${row.brand ?? '-'}`)
      console.log(`    - ${row.name.slice(0, 90)}`)
      console.log(`    + ${next}`)
    }
  }
  show('更新する', safe, 20)
  show('ブランド名だけになる', brandOnly, 15)
  show('詰め過ぎ', shrunk, 15)
  show('名前が衝突', clashing, 15)

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const outputPath = resolve(backupDir, `product-name-summarize-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outputPath, JSON.stringify({
    safe: safe.map(({ row, next }) => ({ id: row.id, category: row.category, brand: row.brand, before: row.name, after: next })),
    brandOnly: brandOnly.map(({ row, next }) => ({ id: row.id, category: row.category, brand: row.brand, before: row.name, after: next })),
    shrunk: shrunk.map(({ row, next }) => ({ id: row.id, category: row.category, brand: row.brand, before: row.name, after: next })),
    clashing: clashing.map(({ row, next }) => ({ id: row.id, category: row.category, brand: row.brand, before: row.name, after: next })),
  }, null, 2))
  console.log(`\n差分: ${outputPath}`)

  if (!APPLY) {
    console.log('--apply を付けると書き込む（ブランド名だけ・詰め過ぎ・衝突の行は書き込まない）')
    return
  }
  // 1行の失敗で全体を止めない。1万件超を流すので、落ちた行だけ最後に出す
  let done = 0
  const failed: Array<{ id: string; next: string; reason: string }> = []
  for (const { row, next } of safe) {
    const { error } = await db.from('products').update({ name: next }).eq('id', row.id)
    if (error) failed.push({ id: row.id, next, reason: error.message })
    else done += 1
    if ((done + failed.length) % 200 === 0) console.log(`  ${done + failed.length}/${safe.length}`)
  }
  console.log(`更新しました: ${done}件 / 失敗: ${failed.length}件`)
  for (const item of failed.slice(0, 20)) console.log(`  ✗ ${item.id} ${item.next} — ${item.reason}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
