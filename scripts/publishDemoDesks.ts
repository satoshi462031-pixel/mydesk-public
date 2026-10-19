/**
 * 公式デモデスクの投入スクリプト（手元PCから実行する）
 *
 *   npm run publish:demo                    # demoDesks.ts の全デモを公開／更新
 *   npm run publish:demo -- --dry-run       # 書き込まずに内容だけ出す
 *   npm run publish:demo -- --only=gaming   # demo-gaming だけ（id の後半で部分一致）
 *   npm run publish:demo -- --unpublish     # 全デモを非公開に戻す（デスクは消さない）
 *   npm run publish:demo -- --emit-thumbs   # アプリ同梱用サムネ(assets/demo/*.jpg)だけ書き出す
 *
 * デモデスクはアプリに同梱せず、公式アカウントの「公開デスク」として出す。
 * ユーザーは一覧から中身を見て、気に入ったときだけ取り込む。
 * 最初から取り込ませるとマイガジェットが他人の機器で埋まり、無料枠のデスク数も食う。
 *
 * publish_desk_snapshot は auth.uid() の所有者チェックを持つ SECURITY DEFINER 関数で、
 * service_role キー（auth.uid() が NULL）では通らない。デモ用アカウントで
 * サインインしてから実行する。写真の保存先も `<自分のuid>/...` に固定されている。
 *
 * .env に必要なもの:
 *   EXPO_PUBLIC_SUPABASE_URL
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY
 *   DEMO_DESK_EMAIL           デモデスクを所有する公式アカウント
 *   DEMO_DESK_PASSWORD
 *   DEMO_DESK_OWNER_NAME      公開ページに出る名前（任意・既定は「MyDesk」。056 で公式の表示名をこれに揃えた。
 *                             「MyDesk 公式」で焼くと、アプリから公開した公式デスクだけ名前が違って並ぶ）
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { BuiltDemoDesk, buildAllDemoDesks } from '../src/constants/demoDesks'
import { applyDeskGadgetUsage } from '../src/utils/deskGadgetUsage'
import { Gadget } from '../src/types'
import { gadgetBrandForPublish } from '../src/utils/brandIdentity'

const BUCKET = 'desk-images'
/** 公開ページの写真。ファイル名を固定して、再実行のたびに増えないようにする */
const PHOTO_NAME = 'demo'
const LONG_EDGE_FULL = 1600
const LONG_EDGE_THUMB = 400
const LONG_EDGE_MEDIUM = 1200
/** アプリに同梱するカード用サムネの横幅。3倍解像度の端末でも粗くならない値 */
const LONG_EDGE_CARD = 900

// ─── .env 読み込み（importRakuten.ts と同じ最小実装）──────────────

function loadEnv(): void {
  let raw: string
  try {
    raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

// ─── 引数 ────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const unpublish = args.includes('--unpublish')
const emitThumbs = args.includes('--emit-thumbs')
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length)

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

// ─── 認証 ────────────────────────────────────────────────────────

/** products は誰でも読めるので、商品DBの照合だけならサインイン不要（dry-run でも使う） */
function createAnonClient(): SupabaseClient {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  const missing = [
    !url && 'EXPO_PUBLIC_SUPABASE_URL',
    !anon && 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean)
  if (missing.length > 0) throw new Error(`.env に ${missing.join(' / ')} を設定してください`)
  return createClient(url!, anon!, { auth: { persistSession: false } })
}

async function signIn(): Promise<{ supabase: SupabaseClient; userId: string }> {
  const email = process.env.DEMO_DESK_EMAIL
  const password = process.env.DEMO_DESK_PASSWORD
  const missing = [
    !email && 'DEMO_DESK_EMAIL',
    !password && 'DEMO_DESK_PASSWORD',
  ].filter(Boolean)
  if (missing.length > 0) throw new Error(`.env に ${missing.join(' / ')} を設定してください`)

  const supabase = createAnonClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email: email!, password: password! })
  if (error) throw new Error(`デモ用アカウントにサインインできません: ${error.message}`)
  return { supabase, userId: data.user.id }
}

// ─── 商品DB との紐付け ───────────────────────────────────────────

/** デモの機器1台ぶんの照合結果 */
type ProductLink = { id: string; hasShopLink: boolean }

/**
 * デモの機器名から商品DBの id を引く。
 *
 * デモの機器名は gadgetPresets.ts から取っており、importRakuten.ts が
 * その正規名のまま products へ upsert している（products.name は unique）ので
 * 完全一致で引ける。
 *
 * ここで productId を焼いておく理由：公開デスクの購入リンクは
 * resolvePurchaseUrl() が解決するが、productId が無いと商品名の完全一致に
 * 頼ることになる。id で持たせておけばデモの表示名を変えてもリンクが切れず、
 * あとから shop_links に Amazon を足したときにも追従する。
 */
async function fetchProductLinks(supabase: SupabaseClient, names: string[]): Promise<Map<string, ProductLink>> {
  const found = new Map<string, ProductLink>()
  const unique = [...new Set(names)]
  const CHUNK = 100
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, shop_links(id)')
      .in('name', unique.slice(i, i + CHUNK))
    if (error) throw error
    for (const row of (data ?? []) as Array<{ id: string; name: string; shop_links?: unknown[] }>) {
      found.set(row.name, { id: row.id, hasShopLink: (row.shop_links ?? []).length > 0 })
    }
  }
  return found
}

/** 購入リンクが出ない機器を洗い出して知らせる（デモは「実物が買える」のが売りなので） */
function reportProductLinks(builts: BuiltDemoDesk[], links: Map<string, ProductLink>): void {
  const names = [...new Set(builts.flatMap((b) => b.gadgets.map((g) => g.name)))]
  const missing = names.filter((n) => !links.has(n))
  const noShopLink = names.filter((n) => links.get(n)?.hasShopLink === false)
  console.log(`\n商品DB照合: ${names.length - missing.length}/${names.length} 件が一致`)
  if (missing.length > 0) {
    console.log(`  ⚠ products に無い（購入リンクが出ません）:\n     ${missing.join('\n     ')}`)
  }
  if (noShopLink.length > 0) {
    console.log(`  ⚠ shop_links が空（購入リンクが出ません）:\n     ${noShopLink.join('\n     ')}`)
  }
}

// ─── 写真アセット → 公開用 JPEG ──────────────────────────────────

/**
 * デモの画像（生成写真または旧SVG）を公開ページの写真として使える JPEG に整形する。
 * サムネイルのパスは getThumbUrl（`.jpg` → `_thumb.jpg`）と同じ規則に合わせる。
 */
async function renderIllustration(file: string): Promise<{ full: Buffer; thumb: Buffer; medium: Buffer }> {
  const source = readFileSync(resolve(process.cwd(), 'assets/demo', file))
  const full = await sharp(source, { density: 144 })
    .resize({ width: LONG_EDGE_FULL, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
  const thumb = await sharp(source, { density: 96 })
    .resize({ width: LONG_EDGE_THUMB, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  // 一覧の1列のタイル用（getMediumUrl：`.jpg` → `_md.jpg`）。無いとタイルはフルサイズを読む
  const medium = await sharp(source, { density: 120 })
    .resize({ width: LONG_EDGE_MEDIUM, withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer()
  return { full, thumb, medium }
}

/**
 * デスク一覧のカードに出すサムネをリポジトリへ書き出す。
 * 一覧は初回起動でネットが無くても出したいので、カードの絵だけはアプリに同梱する
 * （デスクの中身はタップしてから公開デスクを取りに行く）。
 */
async function emitCardThumbnails(): Promise<void> {
  for (const { demo } of buildAllDemoDesks('ja')) {
    const source = readFileSync(resolve(process.cwd(), 'assets/demo', demo.illustration))
    const jpeg = await sharp(source, { density: 120 })
      .resize({ width: LONG_EDGE_CARD, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer()
    const out = resolve(process.cwd(), 'assets/demo', demo.illustration.replace(/\.(svg|png|jpe?g)$/i, '-card.jpg'))
    writeFileSync(out, jpeg)
    console.log(`  ✓ ${out.split(/[\\/]/).slice(-2).join('/')}  ${(jpeg.length / 1024).toFixed(0)}KB`)
  }
}

async function uploadIllustration(
  supabase: SupabaseClient,
  userId: string,
  deskId: string,
  file: string,
): Promise<string> {
  const { full, thumb, medium } = await renderIllustration(file)
  const fullPath = `${userId}/${deskId}/${PHOTO_NAME}.jpg`
  const thumbPath = `${userId}/${deskId}/${PHOTO_NAME}_thumb.jpg`
  const mediumPath = `${userId}/${deskId}/${PHOTO_NAME}_md.jpg`

  for (const [path, body, cache] of [
    [fullPath, full, '3600'],
    [thumbPath, thumb, '86400'],
    [mediumPath, medium, '86400'],
  ] as const) {
    // upsert: true にしないと2回目以降が「既に存在する」で落ちる。
    // ファイル名を固定しているので、上書きしても孤児ファイルは残らない。
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, body, { contentType: 'image/jpeg', cacheControl: cache, upsert: true })
    if (error) throw new Error(`写真のアップロードに失敗しました (${path}): ${error.message}`)
  }

  return supabase.storage.from(BUCKET).getPublicUrl(fullPath).data.publicUrl
}

// ─── 公開 ────────────────────────────────────────────────────────

interface ExistingDesk {
  id: string
  demoId: string | null
}

/**
 * このアカウントが既に公開しているデモデスクを引く。
 * アプリ側は planId → deskId を AsyncStorage に持つが、スクリプトからは参照できない。
 * share_snapshot.plan.id にデモの id をそのまま入れてあるので、それを鍵にする。
 */
async function fetchExistingDesks(supabase: SupabaseClient, userId: string): Promise<ExistingDesk[]> {
  const { data, error } = await supabase
    .from('desks')
    .select('id, share_snapshot')
    .eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => {
    const snapshot = row.share_snapshot as { plan?: { id?: string } } | null
    return { id: row.id as string, demoId: snapshot?.plan?.id ?? null }
  })
}

function buildSnapshot(built: BuiltDemoDesk, productLinks: Map<string, ProductLink>) {
  const { plan, gadgets } = built
  // 撤去済みも share_snapshot には残す。ここに無いとデスクの歴史が「増える一方」になる
  const historyGadgets = gadgets
    .filter((g) => plan.selectedGadgetIds.includes(g.id) || plan.gadgetUsage?.[g.id] != null)
    .map((g) => applyDeskGadgetUsage(plan, g))
  const selectedGadgets = historyGadgets.filter((g) => plan.selectedGadgetIds.includes(g.id))
  const sharedGadgets = historyGadgets.map(({ imageUri: _i, folderIds: _f, ...rest }) => {
    const product = productLinks.get(rest.name)
    return (product && rest.productId === undefined
      ? { ...rest, productId: product.id }
      : rest) as Gadget
  })
  return {
    selectedGadgets,
    totalPrice: selectedGadgets.reduce((sum, g) => sum + (g.price ?? 0), 0),
    shareSnapshot: {
      version: 1,
      plan: { ...plan, images: undefined },
      gadgets: sharedGadgets,
    },
  }
}

async function publishOne(
  supabase: SupabaseClient,
  userId: string,
  ownerName: string,
  built: BuiltDemoDesk,
  existing: ExistingDesk[],
  productLinks: Map<string, ProductLink>,
): Promise<void> {
  const { demo, plan } = built
  const { selectedGadgets, totalPrice, shareSnapshot } = buildSnapshot(built, productLinks)

  const base = {
    title: demo.name,
    description: demo.summaryJa,
    total_price: totalPrice,
    purposes: demo.purposes,
    owner_name: ownerName,
    share_snapshot: shareSnapshot,
  }

  let deskId = existing.find((d) => d.demoId === demo.id)?.id
  if (deskId) {
    // 中身を差し替え終わるまでは非公開のまま。先に公開すると、置換の途中の
    // 中途半端な状態が閲覧者に見えてしまう
    const { error } = await supabase.from('desks').update({ ...base, visibility: 'private' }).eq('id', deskId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('desks')
      .insert({ user_id: userId, ...base, visibility: 'private' })
      .select('id')
      .single()
    if (error) throw error
    deskId = data.id as string
  }

  // ここから公開に戻すまでの間に落ちると、デモデスクが非公開のまま残る。
  // アプリの一覧カード（demoDeskLinks.ts）は deskId を固定で持っているので、
  // 非公開のままだとカードをタップした人に「デスクが見つかりません」が出てしまう。
  // 握り潰さず、どのデスクが非公開のままかを名指しで知らせて中断する。
  let connectionCount = 0
  try {
    const imageUrl = await uploadIllustration(supabase, userId, deskId, demo.illustration)

    // 仮想ノード（wall 等）は devices に実体が無いので、機器同士の線だけを送る
    const selectedIds = new Set(selectedGadgets.map((g) => g.id))
    const connections = (plan.connectionMap?.connections ?? [])
      .filter((c) => selectedIds.has(c.fromGadgetId) && selectedIds.has(c.toGadgetId))
      .map((c) => ({ from_local_id: c.fromGadgetId, to_local_id: c.toGadgetId, cable_type: c.cableType }))
    connectionCount = connections.length

    const { error: snapshotError } = await supabase.rpc('publish_desk_snapshot', {
      p_desk_id: deskId,
      p_devices: selectedGadgets.map((g) => ({
        local_id: g.id,
        name: g.name,
        category: g.category,
        price: g.price ?? null,
        ports: g.ports,
        purchased_at: g.purchasedAt ?? null,
        removed_at: g.removedAt ?? null,
        // 075。アプリの公開（publishService）と同じ材料を焼く。
        // デモの機材名は「24インチ IPSモニター」のような一般名が大半で、ブランドが
        // 付くのは Nintendo Switch 2 のような実名の機材だけ。付く分だけ焼く
        ...gadgetBrandForPublish(g.name),
      })),
      p_connections: connections,
      p_image_urls: [imageUrl],
    })
    if (snapshotError) throw snapshotError

    const { error: publishError } = await supabase
      .from('desks')
      .update({ ...base, visibility: 'public' })
      .eq('id', deskId)
    if (publishError) throw publishError
  } catch (e) {
    console.error(`\n  ✗ ${demo.name} は非公開のまま残りました（deskId: ${deskId}）`)
    console.error('    もう一度 npm run publish:demo を実行して公開状態に戻してください。')
    throw e
  }

  console.log(`  ✓ ${demo.name}`)
  console.log(`    deskId  : ${deskId}`)
  // selectedGadgets は現役だけ。撤去済みは selectedGadgetIds に入らないので別に足して数える
  console.log(`    機器    : ${selectedGadgets.length}台 ＋ 撤去済み ${built.gadgets.length - built.activeGadgets.length}台（歴史のみ）`)
  console.log(`    合計    : ${yen(totalPrice)}`)
  console.log(`    配線    : ${connectionCount}本（電源ノードを除く）`)
}

/**
 * 公開中に出回った写真URLを失効させる。
 * ファイルを消せば同じURLは 404 になり、再公開時は uploadIllustration が入れ直す。
 * @returns 消した写真の件数
 */
async function revokePhotos(supabase: SupabaseClient, userId: string, deskId: string): Promise<number> {
  const prefix = `${userId}/${deskId}`
  const { data: files, error: listError } = await supabase.storage.from(BUCKET).list(prefix)
  if (listError) throw listError
  const paths = (files ?? []).map((f) => `${prefix}/${f.name}`)
  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) throw error
  }
  const { error: rowError } = await supabase.from('desk_photos').delete().eq('desk_id', deskId)
  if (rowError) throw rowError
  return paths.length
}

async function unpublishAll(supabase: SupabaseClient, userId: string, builts: BuiltDemoDesk[]): Promise<void> {
  const existing = await fetchExistingDesks(supabase, userId)
  for (const built of builts) {
    const deskId = existing.find((d) => d.demoId === built.demo.id)?.id
    if (!deskId) {
      console.log(`  - ${built.demo.name}: まだ公開されていません`)
      continue
    }
    const { error } = await supabase.from('desks').update({ visibility: 'private' }).eq('id', deskId)
    if (error) throw error
    // desk-images は public バケットで、/object/public/... は RLS を通らない。
    // visibility を private にしただけでは、URL を知っている人は写真を取り続けられる。
    // アプリ側（publishService.unpublishPlan）はパスを振り直して失効させるので、
    // ここでも実体と行を消して同じ状態にする（再公開時に upload し直される）。
    const removed = await revokePhotos(supabase, userId, deskId)
    console.log(`  ✓ ${built.demo.name}: 非公開にしました（${deskId} / 写真 ${removed}件を失効）`)
  }
}

// ─── メイン ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv()

  const builts = buildAllDemoDesks('ja')
    .filter((b) => !only || b.demo.id.includes(only))
  if (builts.length === 0) throw new Error(`--only=${only} に一致するデモがありません`)

  if (emitThumbs) {
    console.log('=== カード用サムネを書き出します ===')
    await emitCardThumbnails()
    return
  }

  if (dryRun) {
    console.log('=== dry-run（書き込みません）===')
    const productLinks = await fetchProductLinks(
      createAnonClient(),
      builts.flatMap((b) => b.gadgets.map((g) => g.name)),
    )
    for (const built of builts) {
      const { selectedGadgets, totalPrice } = buildSnapshot(built, productLinks)
      const retired = built.gadgets.length - built.activeGadgets.length
      const conns = built.plan.connectionMap?.connections ?? []
      console.log(`\n▼ ${built.demo.name}  [${built.demo.id}]`)
      console.log(`   ${built.demo.summaryJa}`)
      console.log(`   機器 ${selectedGadgets.length}台 / 撤去済み ${retired}台 / 合計 ${yen(totalPrice)}`)
      console.log(`   コンセント ${built.demo.outletCount}口 / 配線 ${conns.length}本`)
      console.log(`   イラスト assets/demo/${built.demo.illustration}`)
      const warnings = built.plan.wiringResult?.warnings ?? []
      if (warnings.length > 0) console.log(`   ⚠ ${warnings.join(' / ')}`)
    }
    reportProductLinks(builts, productLinks)
    return
  }

  const { supabase, userId } = await signIn()
  const ownerName = process.env.DEMO_DESK_OWNER_NAME?.trim() || 'MyDesk'

  if (unpublish) {
    console.log('=== デモデスクを非公開にします ===')
    await unpublishAll(supabase, userId, builts)
    return
  }

  console.log(`=== デモデスクを公開します（${builts.length}本 / owner: ${ownerName}）===`)
  const productLinks = await fetchProductLinks(
    supabase,
    builts.flatMap((b) => b.gadgets.map((g) => g.name)),
  )
  reportProductLinks(builts, productLinks)
  const existing = await fetchExistingDesks(supabase, userId)
  for (const built of builts) {
    await publishOne(supabase, userId, ownerName, built, existing, productLinks)
  }
  console.log('\n完了。公開URLは PublicDesk 画面 / landing の共有リンクから確認できます。')
}

main().catch((error) => {
  console.error('\n失敗しました:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
