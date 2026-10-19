/**
 * products.product_name（画面に出す製品名）へ今の整形ルールを当て直す（手元PCから実行する）
 *
 *   npx tsx scripts/backfillProductDisplayNames.ts                              # 差分を出すだけ
 *   npx tsx scripts/backfillProductDisplayNames.ts --apply                      # 書き込む
 *   npx tsx scripts/backfillProductDisplayNames.ts --restore-truncated --apply  # 途中で切れた名前も元タイトルから作り直す
 *   npx tsx scripts/backfillProductDisplayNames.ts --rebuild-collisions          # 同名へ潰れた候補だけ元タイトルから再生成する
 *   npx tsx scripts/backfillProductDisplayNames.ts --rebuild-from-original       # 元タイトルから表示名を再生成する
 *
 * brand の誤分類を直した結果を使うため、backfillProductBrands.ts の後に実行する。
 *
 * product_name が入っている行は、それに productIdentity を通すだけにする。name から作り直すと
 * 要約の語数や brand の違いで、ルールと関係の無い行まで名前が変わる。
 *
 * --restore-truncated は、要約時の40字切りで語の途中が切れた行（「互換バッテリーパッ」
 * 「R-PNC00M-FC0B-JG」）を、summarizeProductNames が残した元タイトルから作り直す。
 * name も同じく切れているので一緒に直す（name には一意制約があるので、ぶつかる行は飛ばす）。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv, chunk } from './importRakuten'
import { productIdentity, sanitizeProductName } from '../src/utils/productName'
import { compactBrand, isNonBrand } from '../src/utils/brandIdentity'

type ProductRow = {
  id: string
  name: string
  brand: string | null
  product_name: string | null
  category: string | null
  source: string | null
  is_suggestable: boolean
}

type Change = {
  row: ProductRow
  name: string
  productName: string
  isSuggestable: boolean
  reason: 'rules' | 'collision' | 'truncated' | 'unidentified'
}

const APPLY = process.argv.includes('--apply')
const RESTORE_TRUNCATED = process.argv.includes('--restore-truncated')
const REBUILD_COLLISIONS = process.argv.includes('--rebuild-collisions')
const REBUILD_FROM_ORIGINAL = process.argv.includes('--rebuild-from-original')
const backupDir = resolve(process.cwd(), '.codex-backups')

/** summarizeProductNames が書いた差分ファイルから、要約前の元タイトルを id で引く */
function loadOriginalTitles(): Map<string, string> {
  const titles = new Map<string, string>()
  const files = readdirSync(backupDir).filter((file) => /^product-name-summarize-.*\.json$/.test(file)).sort()
  for (const file of files) {
    const data = JSON.parse(readFileSync(resolve(backupDir, file), 'utf8')) as { safe?: Array<{ id: string; before: string }> }
    // safe 以外（詰め過ぎ・衝突）は name に書き込まれていないので、元タイトルとして使わない
    for (const entry of data.safe ?? []) titles.set(entry.id, entry.before)
  }
  return titles
}

/** name の最後の語が、元タイトルではもっと長い語の途中だったか */
function endsMidWord(name: string, original: string): boolean {
  const last = name.split(/\s+/).at(-1)
  if (!last) return false
  const source = sanitizeProductName(original)
  const ends = [...source.matchAll(new RegExp(last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
    .map((match) => (match.index ?? 0) + last.length)
  return ends.length > 0 && ends.every((end) => end < source.length && /[\p{L}\p{N}]/u.test(source[end]))
}

/** 1回目の除去でブランドの別表記が露出する行も、1回の実行で固定点まで整える。 */
function normalizedProductName(name: string, brand: string | null, stored?: string | null): string {
  let current = stored
  const seen: string[] = current ? [current] : []
  for (let pass = 0; pass < 6; pass += 1) {
    const next = productIdentity(name, brand, current).productName
    if (next === current) return next
    if (seen.includes(next)) {
      // ブランドだけまで削れる行は rawName へのフォールバックと往復する。短い側を採り、
      // 呼び出し側で「識別不能」として候補から外す。
      return [...seen, next].sort((a, b) => [...a].length - [...b].length)[0]
    }
    seen.push(next)
    current = next
  }
  return current ?? ''
}

const compactIdentity = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function displayKey(row: ProductRow, productName: string): string {
  const displayName = productIdentity(
    row.name,
    row.brand,
    productName,
    row.source === 'preset',
  ).displayName
  return `${row.category ?? ''}\u0000${compactIdentity(displayName)}`
}

function hasNewIdentityDiscriminator(current: string, candidate: string): boolean {
  const currentCompact = compactIdentity(current)
  const currentTokens = new Set(current.split(/\s+/).map(compactIdentity).filter(Boolean))
  const candidateTokens = candidate.split(/\s+/).filter(Boolean)
  return candidateTokens.some((token) => {
    const compact = compactIdentity(token)
    if (!compact || currentTokens.has(compact) || currentCompact.includes(compact)) return false
    if (/^\d+(?:\.\d+)?(?:gb|tb|mb|kb)$/i.test(token)) return true
    if (/[a-z]/i.test(token) && /\d/.test(token) && compact.length >= 3) return true
    if (/^(?:plus|max|pro|mini|select|slim|neo|se|ii|iii)$/i.test(token)) return true
    const index = candidateTokens.indexOf(token)
    return /^\d{1,2}$/.test(token)
      && index > 0
      && /^(?:pro|mini|neo|quest|mark|mk)$/i.test(candidateTokens[index - 1])
  })
}

/**
 * 現在は同名の行だけを元タイトルから作り直し、容量・世代・型番などによって実際に
 * 衝突が解ける行だけを返す。全件再生成すると正しい短い表示名まで説明文へ戻るため行わない。
 */
function collisionRebuilds(rows: ProductRow[], originals: Map<string, string>): Map<string, string> {
  const groups = new Map<string, ProductRow[]>()
  for (const row of rows) {
    if (!row.is_suggestable || !row.product_name) continue
    const key = displayKey(row, row.product_name)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const result = new Map<string, string>()
  for (const [currentKey, group] of groups) {
    if (group.length < 2) continue
    const candidates = group.map((row) => {
      if (row.source === 'preset') return { row, productName: row.product_name ?? '', key: currentKey }
      const sourceTitle = originals.get(row.id) ?? row.name
      const productName = normalizedProductName(sourceTitle, row.brand)
      const key = hasNewIdentityDiscriminator(row.product_name ?? '', productName)
        ? displayKey(row, productName)
        : currentKey
      return { row, productName, key }
    })
    if (new Set(candidates.map(({ key }) => key)).size < 2) continue
    for (const { row, productName, key } of candidates) {
      if (productName && productName !== row.product_name && key !== currentKey) result.set(row.id, productName)
    }
  }
  return result
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const rows: ProductRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id,name,brand,product_name,category,source,is_suggestable')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as ProductRow[]))
    if (!data || data.length < 1000) break
  }

  const originals = RESTORE_TRUNCATED || REBUILD_COLLISIONS || REBUILD_FROM_ORIGINAL
    ? loadOriginalTitles()
    : new Map<string, string>()
  const collisionProductNames = REBUILD_COLLISIONS ? collisionRebuilds(rows, originals) : new Map<string, string>()
  const takenNames = new Set(rows.map((row) => row.name))
  const skippedClash: ProductRow[] = []

  const changes: Change[] = []
  for (const row of rows) {
    const original = originals.get(row.id)
    if (RESTORE_TRUNCATED && original && endsMidWord(row.name, original)) {
      // name は検索・ショップ照合用の元タイトル。過去の要約で上書きされた行だけ、
      // バックアップに残る販促除去済みの元タイトルへ戻す。
      const name = sanitizeProductName(original)
      if (name !== row.name && takenNames.has(name)) {
        skippedClash.push(row)
      } else if (name) {
        takenNames.delete(row.name)
        takenNames.add(name)
        changes.push({
          row,
          name,
          productName: normalizedProductName(original, row.brand),
          isSuggestable: row.is_suggestable,
          reason: 'truncated',
        })
        continue
      }
    }
    const collisionProductName = collisionProductNames.get(row.id)
    const sourceTitle = REBUILD_FROM_ORIGINAL && original ? original : row.name
    const productName = collisionProductName ?? (REBUILD_FROM_ORIGINAL && row.source !== 'preset'
      ? normalizedProductName(sourceTitle, row.brand)
      : normalizedProductName(row.name, row.brand, row.product_name))
    // 楽天行がブランド名だけになった場合、商品を識別する情報が元タイトルに無い。
    // ブランド棚へ同名の空カードを残すより、予測候補から外す。
    const unidentified = row.source === 'rakuten'
      && row.is_suggestable
      && !!row.brand
      && !isNonBrand(row.brand)
      && compactBrand(productName) === compactBrand(row.brand)
    if (unidentified) {
      changes.push({ row, name: row.name, productName, isSuggestable: false, reason: 'unidentified' })
    } else if (productName && productName !== row.product_name) {
      changes.push({
        row,
        name: row.name,
        productName,
        isSuggestable: row.is_suggestable,
        reason: collisionProductName ? 'collision' : 'rules',
      })
    }
  }

  const byReason = (reason: Change['reason']) => changes.filter((change) => change.reason === reason)
  console.log(`商品 ${rows.length}件 / 変更 ${changes.length}件`)
  console.log(`  整形ルールを当て直す ${byReason('rules').length}件`)
  console.log(`  同名衝突を元タイトルから分離 ${byReason('collision').length}件`)
  console.log(`  識別不能な候補を非表示 ${byReason('unidentified').length}件`)
  if (RESTORE_TRUNCATED) {
    console.log(`  途中で切れた名前を作り直す ${byReason('truncated').length}件（name が衝突して飛ばした ${skippedClash.length}件）`)
  }
  for (const reason of ['rules', 'collision', 'unidentified', 'truncated'] as const) {
    const samples = byReason(reason).slice(0, 25)
    if (samples.length === 0) continue
    console.log(`\n■ ${reason}`)
    for (const { row, name, productName, isSuggestable } of samples) {
      if (name !== row.name) console.log(`  name: ${row.name}\n     → ${name}`)
      console.log(`  ${row.product_name ?? '（空）'}\n     → ${productName}`)
      if (isSuggestable !== row.is_suggestable) console.log('  is_suggestable: true → false')
    }
  }

  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `product-display-name-before-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(changes.map(({ row, name, productName, isSuggestable, reason }) => ({
    id: row.id,
    brand: row.brand,
    category: row.category,
    source: row.source,
    reason,
    name: row.name,
    nameAfter: name,
    before: row.product_name,
    after: productName,
    isSuggestableBefore: row.is_suggestable,
    isSuggestableAfter: isSuggestable,
  })), null, 2))
  console.log(`\n差分（兼 更新前バックアップ）: ${backupPath}`)

  if (!APPLY || changes.length === 0) {
    if (!APPLY) console.log('--apply を付けると書き込む（今回は差分を出しただけ）')
    return
  }

  let updated = 0
  for (const part of chunk(changes, 500)) {
    const { error } = await db.from('products').upsert(
      part.map(({ row, name, productName, isSuggestable }) => ({
        id: row.id,
        name,
        product_name: productName,
        is_suggestable: isSuggestable,
      })),
      { onConflict: 'id' },
    )
    if (error) throw new Error(`product_name の更新に失敗: ${error.message}`)
    updated += part.length
    console.log(`更新: ${updated}/${changes.length}`)
  }
  console.log(`更新完了: ${updated}件`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
