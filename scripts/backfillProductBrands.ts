// products.brand を商品名から引き直す。
//
//   npx tsx scripts/backfillProductBrands.ts            # 差分を見るだけ
//   npx tsx scripts/backfillProductBrands.ts --apply    # 実際に書き込む
//   npx tsx scripts/backfillProductBrands.ts --fill-missing --apply # 空欄も補完する
//
// 楽天の商品検索APIはブランド名を値で返さない（attributeFlag=1 で「ブランド名」という
// 属性が存在することは分かるが、値も属性値での絞り込みも返ってこない）。取り込み時と同じく
// 名前から引くしかないが、brandIdentity.ts の辞書は取り込み後も育っているので、
// 過去に取り込んだ行を今の辞書で引き直すと埋まるものがある。
//
// 触るのは次の種類だけ。既に妥当なブランドが入っている行は動かさない。
//   1. brand が空 → 名前から引けたら入れる
//   2. brand が規格名・対応機種名・型番（USB-C / PS5 / VW-VBT380-K など）→ 引き直すか、引けなければ空にする
//   3. brand が2語のブランドの頭だけ（OM / BIGBIG）→ 辞書の2語の名前へ戻す
//   4. 製品ファミリ名（Echo / Xperia / DualSense）→ メーカー名へ戻す
//   5. 過去の部分一致による誤分類（Google TV / ProDesk / HORIZON など）→ 再分類する
// 表記ゆれ（ロジクール と Logicool）は列を書き換えず brandKey() が表示時に束ねる。
// 名前の先頭語で寄せると `ROAD WARRIOR` が `ROAD` になるなど、正しい値を壊す。
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chunk, createAdminClient, loadEnv } from './importRakuten'
import {
  brandFromGadgetName,
  brandFromName,
  brandAliases,
  brandDisplay,
  brandKey,
  compactBrand,
  isNonBrand,
  knownBrandInName,
  makerOfProductFamily,
} from '../src/utils/brandIdentity'
import { productIdentity, sanitizeProductName } from '../src/utils/productName'

type ProductRow = {
  id: string
  name: string
  brand: string | null
  product_name: string | null
  source: string | null
}

type Change = {
  row: ProductRow
  next: string | null
  reason: 'fill' | 'nonBrand' | 'extend' | 'family' | 'reclassify'
}

const APPLY = process.argv.includes('--apply')
const FILL_MISSING = process.argv.includes('--fill-missing')

/**
 * ブランドの引き方は行の出どころで変える。
 *
 * 楽天の商品名は対応機種を先頭に並べる（「MacBook Pro 14インチ用 スリーブ」）ので、
 * 機種名をメーカーとして読むとノーブランドのアクセサリが Apple 製品になる。
 * プリセット行は自分たちが書いた名前でその問題が無く、逆に本体が
 * 「MacBook Air 13" M4」とメーカー名を名乗らないので、手元のガジェットと
 * 同じ判定（製品ファミリ名 → メーカー）を使う。
 *
 * 実測：プリセット764件のうち brand 空51件から39件（Apple 30 / Microsoft 9）が
 * 埋まり、すでに brand が入っている713件は判定が1件も変わらない。
 */
function detectBrandForRow(row: ProductRow): string | null {
  const detect = row.source === 'preset' ? brandFromGadgetName : brandFromName
  const detected = detect(row.name)
  return detected ? (brandDisplay(detected, 'en') ?? detected) : null
}

/**
 * 型番を誤って brand にしていた行は、後ろに並ぶ対応メーカーを新しいブランドへしない。
 * 販促語を除いた先頭にメーカー名がある場合だけ、作り手として採用する。
 */
function brandStartsName(name: string, brand: string): boolean {
  const normalizedName = sanitizeProductName(name)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()
    .replace(/^(?:(?:(?:メーカー)?純正品?|未使用品?|未開封品?|開封済み|新品|正規品?|simフリー)[\s/・]*)+/u, '')
  const key = brandKey(brand)
  const spellings = key ? brandAliases(key) : []
  const candidates = spellings.length > 0 ? spellings : [brand]
  return candidates.some((candidate) => {
    const normalized = candidate.normalize('NFKC').toLocaleLowerCase().trim()
    if (!normalizedName.startsWith(normalized)) return false
    const next = normalizedName[normalized.length]
    return next === undefined || !/[\p{L}\p{N}]/u.test(next)
  })
}

// 過去の部分一致で誤帰属が実測されたブランド。名前の先頭にも再判定結果にも
// 裏付けが無い行は、誤ったブランド棚へ残すより空へ戻す。
const STALE_EMBEDDED_BRAND_IDS = new Set([
  'apple', 'google', 'meta', 'lg', 'hp', 'rode', 'hori', 'nec',
  'プラス',
])

function decide(row: ProductRow): Change | null {
  const current = row.brand?.trim() ?? ''
  const detected = detectBrandForRow(row)

  // 誤ブランドを空へ直した行まで次回実行で復活させない。空欄補完は明示指定時だけ。
  if (!current) return FILL_MISSING && detected ? { row, next: detected, reason: 'fill' } : null

  // プリセットの製品ファミリ名をメーカーへ寄せる（Yoga → Lenovo、DualSense → PlayStation）。
  const familyMaker = row.source === 'preset' ? makerOfProductFamily(row.name) : undefined
  if (familyMaker && brandKey(familyMaker) !== brandKey(current)) {
    return { row, next: familyMaker, reason: 'family' }
  }

  // 規格名・対応機種名が入っている行。引き直せるなら差し替え、駄目なら空にする
  if (isNonBrand(current)) {
    const next = detected && (row.source === 'preset' || brandStartsName(row.name, detected))
      ? detected
      : null
    return { row, next, reason: 'nonBrand' }
  }
  // 2語のブランドの頭だけが入っている行（OM → OM SYSTEM / BIGBIG → BIGBIG WON）
  const known = knownBrandInName(row.name)
  if (known && compactBrand(known) !== compactBrand(current) && compactBrand(known).startsWith(compactBrand(current))) {
    return { row, next: brandDisplay(known, 'en') ?? known, reason: 'extend' }
  }

  if (row.source !== 'preset') {
    const currentKey = brandKey(current)
    const detectedKey = brandKey(detected)
    const detectedStarts = !!detected && brandStartsName(row.name, detected)

    // 名前の先頭に別メーカーが明示されているなら、古い部分一致の結果を置き換える。
    if (detectedStarts && detectedKey && detectedKey !== currentKey) {
      return { row, next: detected, reason: 'reclassify' }
    }

    // Google TV、ProDesk→RODE、HORIZON→HORI、Low-G→LG などの旧誤判定を除去する。
    if (currentKey && STALE_EMBEDDED_BRAND_IDS.has(currentKey)
      && detectedKey !== currentKey && !brandStartsName(row.name, current)) {
      return { row, next: detectedStarts ? detected : null, reason: 'reclassify' }
    }
  }
  return null
}

/**
 * brand を差し替える行は product_name も作り直す。product_name は古い brand を
 * 名前の頭から剥がした残りで（brand=OM なら「SYSTEM リニアPCM…」）、brand だけ
 * 替えると表示が「OM SYSTEM SYSTEM …」や型番の欠けた名前になる。
 * 空欄を埋めるだけの行は、表示時に新しい brand を頭から剥がせるので触らない。
 */
function nextProductName({ row, next, reason }: Change): string | null {
  if (reason === 'fill') return row.product_name
  return productIdentity(row.name, next).productName || row.product_name
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const rows: ProductRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id,name,brand,product_name,source')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as ProductRow[]))
    if (!data || data.length < 1000) break
  }

  const changes = rows.map(decide).filter((c): c is Change => c !== null)
  const byReason = (reason: Change['reason']) => changes.filter((c) => c.reason === reason)

  console.log(`商品 ${rows.length}件 / 変更 ${changes.length}件`)
  console.log(`  空欄を埋める        ${byReason('fill').length}件`)
  console.log(`  規格・機種名を直す  ${byReason('nonBrand').length}件`
    + `（うち空にする ${byReason('nonBrand').filter((c) => !c.next).length}件）`)
  console.log(`  2語のブランドへ戻す ${byReason('extend').length}件`)
  console.log(`  製品ファミリをメーカーへ ${byReason('family').length}件`)
  console.log(`  誤った部分一致を再分類 ${byReason('reclassify').length}件`)
  console.log(`  変更後もブランド空  ${rows.filter((r) => !r.brand?.trim()).length - byReason('fill').length}件`)

  const reclassifiedPairs = new Map<string, number>()
  for (const change of byReason('reclassify')) {
    const pair = `${change.row.brand ?? '（空）'} → ${change.next ?? '（空）'}`
    reclassifiedPairs.set(pair, (reclassifiedPairs.get(pair) ?? 0) + 1)
  }
  if (reclassifiedPairs.size > 0) {
    console.log('  再分類の内訳（上位30）')
    for (const [pair, count] of [...reclassifiedPairs].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
      console.log(`    ${String(count).padStart(4)}件  ${pair}`)
    }
  }

  // 辞書に無いものは商品名の先頭語をそのまま採っている。書き込む前に人が見る場所。
  // 製品ファミリ名から引いたもの（MacBook → Apple）は推定ではないので混ぜない
  const guessed = changes.filter(
    (c) => c.next && !knownBrandInName(c.row.name) && !makerOfProductFamily(c.row.name),
  )
  console.log('')
  console.log(`■ 辞書に無く先頭語から推定したもの ${guessed.length}件（要確認・先頭25件）`)
  for (const { row, next } of guessed.slice(0, 25)) {
    console.log(`  ${String(next).padEnd(18)} ${row.name.slice(0, 52)}`)
  }
  console.log('')
  for (const reason of ['fill', 'nonBrand', 'extend', 'family', 'reclassify'] as const) {
    const samples = byReason(reason).slice(0, reason === 'fill' ? 20 : 6)
    if (samples.length === 0) continue
    console.log(`■ ${reason}`)
    for (const change of samples) {
      const { row, next } = change
      console.log(`  ${String(row.brand ?? '（空）').padEnd(12)} → ${String(next ?? '（空）').padEnd(14)} ${row.name.slice(0, 46)}`)
      if (reason !== 'fill') console.log(`  ${''.padEnd(12)}   product_name: ${row.product_name ?? '（空）'} → ${nextProductName(change) ?? '（空）'}`)
    }
    console.log('')
  }

  if (!APPLY || changes.length === 0) {
    if (!APPLY) console.log('--apply を付けると書き込む（今回は差分を出しただけ）')
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `product-brand-before-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(changes.map((change) => ({
    id: change.row.id,
    name: change.row.name,
    source: change.row.source,
    reason: change.reason,
    before: change.row.brand,
    after: change.next,
    productNameBefore: change.row.product_name,
    productNameAfter: nextProductName(change),
  })), null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  let updated = 0
  for (const part of chunk(changes, 500)) {
    // name も送るのは upsert が not null 列を要求するため（表示名バックフィルと同じ）
    const { error } = await db.from('products').upsert(
      part.map((change) => ({
        id: change.row.id,
        name: change.row.name,
        brand: change.next,
        product_name: nextProductName(change),
      })),
      { onConflict: 'id' },
    )
    if (error) throw new Error(`brand の更新に失敗: ${error.message}`)
    updated += part.length
    console.log(`更新: ${updated}/${changes.length}`)
  }
  console.log(`更新完了: ${updated}件`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
