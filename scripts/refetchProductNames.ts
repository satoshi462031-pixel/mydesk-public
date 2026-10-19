/**
 * 48文字で切り詰められた商品名を、楽天から正式名で取り直す（手元PCから実行する）
 *
 *   npx tsx scripts/refetchProductNames.ts --limit 200          # 取得して差分を出すだけ
 *   npx tsx scripts/refetchProductNames.ts --limit 200 --apply  # 実際に書き込む
 *
 * 2026-07-25 と 2026-08-01 の取り込みは商品名を48文字で切っていた（8/19 の取り込みでは
 * 直っている）。切られた名前からは製品名も品番も復元できないので、`shop_links` に残る
 * 楽天の商品ページURLから商品コードを起こして引き直す。
 *
 * 楽天APIは1リクエスト1商品・約1.1秒間隔なので、対象1万件超を一度には流せない。
 * `--limit` で刻んで何回かに分ける。実行のたびに未処理ぶんだけを対象にするので、
 * 途中で止めても次の実行が続きになる。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REQUEST_INTERVAL_MS, createAdminClient, loadEnv, searchRakuten, sleep } from './importRakuten'
import { sanitizeProductName } from '../src/utils/productName'

type Row = { id: string; name: string; category: string | null; source: string | null }
type Link = { product_id: string; affiliate_url: string | null; official_url: string | null }

const APPLY = process.argv.includes('--apply')
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0
/** 切り詰めの痕跡。48文字ちょうどのほか、末尾の空白を落とした行があるので少し幅を持たせる */
const TRUNCATED_MIN = 46
const TRUNCATED_MAX = 48

const charLength = (value: string) => [...value].length

/**
 * アフィリエイトURLに埋まっている元の商品ページのURLを取り出す。
 * `...?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fcocohouse%2Fb078xxydwz%2F&m=...`
 *
 * 楽天API の `itemCode`（ショップコード:管理番号）は**このURLからは起こせない**。
 * `edion/4544438016548` の実体は `edion:10850253` のように別の番号で、
 * URL の末尾を itemCode として渡すと wrong_parameter で弾かれる。
 * そこで URL 末尾をキーワードにして検索し、`itemUrl` が一致した1件だけを採用する。
 */
function itemUrlFrom(link: Link): { canonical: string; keyword: string } | null {
  for (const url of [link.affiliate_url, link.official_url]) {
    if (!url) continue
    const match = /(item\.rakuten\.co\.jp\/[^/?&]+\/[^/?&]+)/.exec(decodeURIComponent(url))
    if (!match) continue
    const canonical = match[1].replace(/\/$/, '')
    const keyword = canonical.split('/').pop() ?? ''
    if (keyword.length >= 2) return { canonical, keyword }
  }
  return null
}

// Supabase の max-rows は 1000。range の終端を広げても切れるので必ずページングする
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const db = createAdminClient()
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order('id').range(from, from + 999)
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main(): Promise<void> {
  loadEnv()
  if (!process.env.RAKUTEN_APP_ID || !process.env.RAKUTEN_ACCESS_KEY) {
    throw new Error('RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が未設定。.env を確認する')
  }
  const db = createAdminClient()

  const products = await fetchAll<Row>('products', 'id,name,category,source')
  const links = await fetchAll<Link>('shop_links', 'product_id,affiliate_url,official_url')
  const linkByProduct = new Map<string, Link>()
  for (const link of links) if (!linkByProduct.has(link.product_id)) linkByProduct.set(link.product_id, link)

  const truncated = products.filter((row) =>
    row.source !== 'preset' &&
    charLength(row.name) >= TRUNCATED_MIN &&
    charLength(row.name) <= TRUNCATED_MAX)
  const withCode = truncated
    .map((row) => {
      const link = linkByProduct.get(row.id)
      return { row, ref: link ? itemUrlFrom(link) : null }
    })
    .filter((entry): entry is { row: Row; ref: { canonical: string; keyword: string } } => entry.ref !== null)

  console.log(`切り詰められた疑いのある行: ${truncated.length}件`)
  console.log(`  楽天の商品ページURLが残っている: ${withCode.length}件`)
  const targets = LIMIT > 0 ? withCode.slice(0, LIMIT) : withCode
  const estimate = Math.round(targets.length * REQUEST_INTERVAL_MS / 1000 / 60)
  console.log(`  今回の対象: ${targets.length}件（所要 約${estimate}分）`)

  const existingNames = new Map<string, string>()
  for (const row of products) existingNames.set(row.name, row.id)

  const updates: Array<{ id: string; before: string; after: string }> = []
  const skipped: Array<{ id: string; before: string; after: string; reason: string }> = []
  let missing = 0
  let index = 0
  let applied = 0

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const outputPath = resolve(backupDir, `product-name-refetch-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const writeReport = () => writeFileSync(outputPath, JSON.stringify({ updates, skipped }, null, 2))

  for (const { row, ref } of targets) {
    index += 1
    if (index % 50 === 0) console.log(`  ${index}/${targets.length}`)
    const items = await searchRakuten({ keyword: ref.keyword })
    await sleep(REQUEST_INTERVAL_MS)
    // 同じキーワードで他店の商品も並ぶ。URL が一致した1件だけを信じる
    const hit = items?.find((item) => decodeURIComponent(item.itemUrl ?? '').includes(ref.canonical))
    const raw = hit?.itemName
    if (!raw) { missing += 1; continue }
    const next = sanitizeProductName(raw)
    if (!next || next === row.name) continue
    // 取り直したのに短いなら、それは切り詰めではなく元から短い名前。触らない
    if (charLength(next) <= charLength(row.name)) {
      skipped.push({ id: row.id, before: row.name, after: next, reason: '長くならない' })
      continue
    }
    const owner = existingNames.get(next)
    if (owner && owner !== row.id) {
      skipped.push({ id: row.id, before: row.name, after: next, reason: '同名の行が既にある' })
      continue
    }
    updates.push({ id: row.id, before: row.name, after: next })
    existingNames.set(next, row.id)

    // 1万件を3時間かけて取るので、最後にまとめて書くと途中で落ちたときすべて失われる。
    // 取れた行からその場で書き、次回の実行は残った行だけを対象にする
    if (APPLY) {
      const { error } = await db.from('products').update({ name: next }).eq('id', row.id)
      if (error) {
        skipped.push({ id: row.id, before: row.name, after: next, reason: `更新に失敗: ${error.message}` })
        updates.pop()
      } else {
        applied += 1
      }
    }
    if (updates.length % 100 === 0) writeReport()
  }

  console.log(`\n取り直せた: ${updates.length}件 / 楽天に無い（終了商品など）: ${missing}件 / 見送り: ${skipped.length}件`)
  for (const update of updates.slice(0, 10)) {
    console.log(`  - ${update.before}`)
    console.log(`  + ${update.after.slice(0, 100)}`)
  }

  writeReport()
  console.log(`差分: ${outputPath}`)
  if (APPLY) console.log(`書き込み済み: ${applied}件`)
  else console.log('--apply を付けると書き込む')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
