/**
 * キーボード以外のカテゴリのポート構成を判定して JSON に書き出す（手元PCから実行する）
 *
 *   npx tsx scripts/researchProductPorts.ts --category Dock,Hub        # 名前・説明だけで判定
 *   npx tsx scripts/researchProductPorts.ts --group b1 --fetch         # 名前で決まらないものは商品ページを見る
 *   npx tsx scripts/researchProductPorts.ts --group all --sample 20
 *
 * カテゴリごとの抽出ルールは productPortRules.ts。接続方式（有線 / 2.4GHz / Bluetooth）の判定は
 * キーボードで作った connectionModes を共用する。判定できないものは書かない。
 *
 * 出力は .codex-backups/product-port-research-<group>-<stamp>.json で、
 * scripts/updateProductPorts.ts がこれを読んで products.ports を更新する。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GadgetCategory, Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'
import { connectionModes } from './researchKeyboardPorts'
import { applyRule, CATEGORY_SPECS, specFor, toPorts, type CategorySpec, type MatchedRule } from './productPortRules'

type Product = {
  id: string
  name: string
  description: string | null
  category: string | null
  source: string | null
  shop_links: Array<{ official_url: string | null; affiliate_url: string | null }>
}

export type ProductPortDecision = {
  id: string
  name: string
  category: GadgetCategory
  ports: Port[]
  origin: 'name' | 'page'
  sourceUrl: string | null
  evidence: string[]
}

type Unresolved = { id: string; name: string; category: string; reason: string; sourceUrl: string | null }

export type ProductPortResearch = {
  generatedAt: string
  categories: string[]
  fetched: boolean
  decided: ProductPortDecision[]
  unresolved: Unresolved[]
}

/** 実行単位。名前だけで決まりやすい順に並べてある */
export const GROUPS: Record<string, GadgetCategory[]> = {
  b1: ['Dock', 'Hub', 'KVM', 'CaptureDevice', 'Router', 'NetworkSwitch', 'Modem', 'Charger', 'PowerStrip'],
  a: ['Mouse', 'Controller', 'Headphone', 'Earphone', 'Speaker', 'Webcam', 'Microphone', 'PenTablet'],
  b2: ['Storage', 'Printer', 'Projector', 'StreamingDevice', 'SmartHome', 'Light', 'MonitorArm', 'MicArm'],
  // 機種が分かれば口も決まるもの（ゲーム機・スマホ）と、入出力の系統数が要るオーディオ機器
  b3: ['GameConsole', 'Smartphone', 'Tablet', 'Monitor', 'MobileBattery', 'AudioInterface', 'Mixer', 'HeadphoneAmp', 'Amplifier', 'Instrument'],
}
GROUPS.all = [...GROUPS.b1, ...GROUPS.a, ...GROUPS.b2, ...GROUPS.b3]

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
}

function visibleText(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; MyDeskPortSpecAudit/1.0)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  const contentType = response.headers.get('content-type') ?? ''
  const prefix = new TextDecoder('ascii').decode(bytes.slice(0, 4096))
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]
    ?? prefix.match(/charset=["']?([^"'\s/>]+)/i)?.[1]
    ?? 'utf-8'
  const encoding = /shift[_-]?jis|sjis|windows-31j/i.test(charset)
    ? 'shift_jis'
    : /euc[_-]?jp/i.test(charset) ? 'euc-jp' : 'utf-8'
  return visibleText(new TextDecoder(encoding).decode(bytes))
}

/**
 * ページ全文をそのまま判定にかけると関連商品やレビューの記述を拾う。
 * 仕様が書かれていそうな場所の周辺だけを切り出す。
 */
function specContext(text: string): string {
  const marker = /接続方式|接続方法|インターフェ[イー]ス|仕様|スペック|端子|ポート|入力|出力/gi
  const ranges: Array<[number, number]> = []
  for (const match of text.matchAll(marker)) {
    const start = Math.max(0, (match.index ?? 0) - 100)
    const end = Math.min(text.length, (match.index ?? 0) + 200)
    const previous = ranges.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else ranges.push([start, end])
    if (ranges.length >= 14) break
  }
  return ranges.map(([start, end]) => text.slice(start, end)).join(' … ')
}

function productUrl(product: Product): string | null {
  for (const link of product.shop_links) {
    const raw = link.official_url ?? link.affiliate_url
    if (!raw) continue
    try {
      const url = new URL(raw)
      const target = url.searchParams.get('pc')
      return target ? decodeURIComponent(target) : raw
    } catch {}
  }
  return null
}

type Evaluation = { ok: true; ports: Port[]; evidence: string[] } | { ok: false; reason: string }

/** 商品名・説明など、呼び出し側が信頼できる範囲に絞った本文から厳格ルールで判定する */
export function inferProductPorts(category: GadgetCategory, text: string, name = text): Evaluation {
  const spec = specFor(CATEGORY_SPECS, category, text)
  return spec ? evaluate(spec, text, name) : { ok: false, reason: 'rule-undefined' }
}

/** 接続方式スペックを持つカテゴリ（マウス等）の接続ポートを組み立てる */
function connectionPorts(spec: CategorySpec, text: string): Evaluation {
  const connection = spec.connection!
  const resolved = connectionModes(text)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  const { modes } = resolved
  const matched: MatchedRule[] = []

  if (modes.dongle && connection.dongle) {
    // レシーバーはPCに直挿しするのでケーブルは要らない
    matched.push({ type: 'USB_A', direction: 'input', count: 1, label: '2.4GHzレシーバー', directAttach: true, evidence: '2.4GHz' })
    if (modes.bluetooth) matched.push({ type: 'Bluetooth', direction: 'bidirectional', count: 1, evidence: 'bt' })
  } else if (modes.bluetooth) {
    matched.push({ type: 'Bluetooth', direction: 'bidirectional', count: 1, evidence: 'bt' })
  } else if (modes.dongle && !connection.dongle) {
    // レシーバーを持たないはずのカテゴリで 2.4GHz を名乗る = 別商品の記述を拾っている
    return { ok: false, reason: 'dongle-unexpected' }
  }

  if (modes.wired) {
    const hit = connection.wired.find((candidate) => candidate.patterns.some((pattern) => pattern.test(text)))
    const chosen = hit ?? connection.wiredFallback
    if (chosen) {
      matched.push({
        type: chosen.type,
        direction: 'input',
        count: 1,
        label: 'label' in chosen ? chosen.label : undefined,
        evidence: 'wired',
      })
    }
  }
  if (matched.length === 0) return { ok: false, reason: 'no-connection' }
  return { ok: true, ports: toPorts(matched), evidence: resolved.evidence }
}

function evaluate(spec: CategorySpec, text: string, name = text): Evaluation {
  // 「本体ではない」の判定は商品名だけで行う。説明文には付属品や接続方法の案内として
  // 「ケーブル」「カバー」が普通に出てくるので、そこまで見ると本体まで弾いてしまう
  // （「Yamaha HS5 スタジオモニター」が説明文の一語で除外されていた）。
  // 端子の根拠を読むほうは説明文も含めた text を使う。
  if (spec.exclude?.test(name)) return { ok: false, reason: 'excluded' }
  if (spec.require && !spec.require.test(text)) return { ok: false, reason: 'not-a-device' }

  const matched: MatchedRule[] = []
  const evidence: string[] = []
  let connectionEvidence: string[] = []
  // 接続方式が読み取れなくても、型番などから口が決まることがある。
  // ここでは打ち切らず、最後にポートが足りているかで判断する
  let connectionReason: string | null = null

  if (spec.connection) {
    const connection = connectionPorts(spec, text)
    if (!connection.ok) connectionReason = connection.reason
    else matched.push(...connection.ports.map((port) => ({
      type: port.type,
      direction: port.direction,
      count: port.count,
      label: port.label,
      directAttach: port.directAttach,
      evidence: 'connection',
    })))
    if (connection.ok) connectionEvidence = connection.evidence
  }

  const rules = connectionReason
    ? [...(spec.rules ?? []), ...(spec.connectionFallbackRules ?? [])]
    : (spec.rules ?? [])
  for (const rule of rules) {
    const hit = applyRule(text, rule)
    if (!hit) continue
    matched.push(hit)
    if (hit.evidence !== '既定値') evidence.push(`${hit.type}/${hit.direction}: ${hit.evidence}`)
  }

  const ports = toPorts(matched)
  if (ports.length < (spec.minPorts ?? 1)) return { ok: false, reason: connectionReason ?? 'not-enough-evidence' }
  // 接続方式を持つカテゴリで上位機器へつながる口が1つも無いと、保存時にフォームが
  // 勝手に有線の口を足す。イヤホンジャックだけ拾ったコントローラー等がこれに当たる
  if (spec.connection && !ports.some((port) =>
    port.type === 'Bluetooth' || port.directAttach || (port.direction === 'input' && !!port.label))) {
    return { ok: false, reason: connectionReason ?? 'no-connection' }
  }
  // 根拠がすべて既定値なら、その商品について何も読み取れていないのと同じ
  if (evidence.length === 0 && connectionEvidence.length === 0 && !spec.allowDefaultsOnly) {
    return { ok: false, reason: 'no-evidence' }
  }
  return { ok: true, ports, evidence: [...connectionEvidence, ...evidence] }
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const shouldFetch = process.argv.includes('--fetch')
  const limit = Number(argValue('--limit') ?? '0')
  const sample = Number(argValue('--sample') ?? '0')
  const groupName = argValue('--group')
  const categories = (argValue('--category')?.split(',').filter(Boolean) as GadgetCategory[] | undefined)
    ?? GROUPS[groupName ?? 'all']
  if (!categories) throw new Error(`--group は ${Object.keys(GROUPS).join(' / ')} のいずれか`)

  const decided: ProductPortDecision[] = []
  const unresolved: Unresolved[] = []
  const needsPage: Array<{ product: Product; reason: string }> = []

  for (const category of categories) {
    const spec = CATEGORY_SPECS[category]
    if (!spec) { console.log(`${category}: ルール未定義のためスキップ`); continue }
    // Supabase の max-rows は 1000。range の終端を広げても切れるので必ずページングする
    const products: Product[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('products')
        .select('id,name,description,category,source,shop_links(official_url,affiliate_url)')
        .eq('category', category)
        .order('name')
        .range(from, from + 999)
      if (error) throw new Error(`${category} の取得に失敗: ${error.message}`)
      products.push(...((data ?? []) as Product[]))
      if (!data || data.length < 1000) break
    }
    let decidedHere = 0
    for (const product of products) {
      const text = `${product.name} ${product.description ?? ''}`
      const result = inferProductPorts(category, text, product.name)
      if (result.ok) {
        decided.push({
          id: product.id,
          name: product.name,
          category,
          ports: result.ports,
          origin: 'name',
          sourceUrl: null,
          evidence: result.evidence,
        })
        decidedHere += 1
      } else if (result.reason === 'excluded' || result.reason === 'not-a-device') {
        unresolved.push({ id: product.id, name: product.name, category, reason: result.reason, sourceUrl: null })
      } else {
        needsPage.push({ product, reason: result.reason })
      }
    }
    console.log(`${category}: ${products.length}件中 ${decidedHere}件を名前から判定`)
  }

  const targets = limit > 0 ? needsPage.slice(0, limit) : needsPage
  if (shouldFetch) {
    console.log(`\n商品ページを取得: ${targets.length}件`)
    let done = 0
    for (let index = 0; index < targets.length; index += 5) {
      await Promise.all(targets.slice(index, index + 5).map(async ({ product, reason }) => {
        const category = product.category as GadgetCategory
        const spec = specFor(CATEGORY_SPECS, category, product.name)!
        const url = productUrl(product)
        if (!url) {
          unresolved.push({ id: product.id, name: product.name, category, reason: `${reason}/no-url`, sourceUrl: null })
          return
        }
        try {
          const context = specContext(await fetchText(url))
          const result = evaluate(spec, `${product.name} ${context}`, product.name)
          if (result.ok) {
            decided.push({
              id: product.id,
              name: product.name,
              category,
              ports: result.ports,
              origin: 'page',
              sourceUrl: url,
              evidence: result.evidence,
            })
          } else {
            unresolved.push({ id: product.id, name: product.name, category, reason: `page/${result.reason}`, sourceUrl: url })
          }
        } catch (fetchError) {
          unresolved.push({
            id: product.id,
            name: product.name,
            category,
            reason: `fetch-failed: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            sourceUrl: url,
          })
        }
      }))
      done += Math.min(5, targets.length - index)
      if (done % 100 === 0 || done === targets.length) console.log(`  ${done}/${targets.length}`)
    }
    for (const { product, reason } of needsPage.slice(targets.length)) {
      unresolved.push({ id: product.id, name: product.name, category: product.category ?? '', reason, sourceUrl: null })
    }
  } else {
    for (const { product, reason } of needsPage) {
      unresolved.push({ id: product.id, name: product.name, category: product.category ?? '', reason, sourceUrl: null })
    }
  }

  const research: ProductPortResearch = {
    generatedAt: new Date().toISOString(),
    categories,
    fetched: shouldFetch,
    decided,
    unresolved,
  }
  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const label = groupName ?? categories.join('-').slice(0, 40)
  const outPath = resolve(backupDir, `product-port-research-${label}-${research.generatedAt.replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(research, null, 2))

  const byCategory: Record<string, { decided: number; unresolved: number }> = {}
  for (const decision of decided) {
    byCategory[decision.category] ??= { decided: 0, unresolved: 0 }
    byCategory[decision.category].decided += 1
  }
  for (const item of unresolved) {
    byCategory[item.category] ??= { decided: 0, unresolved: 0 }
    byCategory[item.category].unresolved += 1
  }
  const byReason: Record<string, number> = {}
  for (const item of unresolved) {
    const key = item.reason.split(':')[0]
    byReason[key] = (byReason[key] ?? 0) + 1
  }

  console.log(`\n判定 ${decided.length}件 / 未判定 ${unresolved.length}件`)
  console.table(byCategory)
  console.log('未判定の理由:', byReason)
  console.log(`出力: ${outPath}`)

  if (sample > 0) {
    console.log('\n--- 判定サンプル ---')
    for (const decision of [...decided].sort(() => Math.random() - 0.5).slice(0, sample)) {
      const shape = decision.ports
        .map((port) => `${port.type}${port.direction === 'output' ? '↑' : port.direction === 'input' ? '↓' : '↔'}${port.count}`)
        .join(' ')
      console.log(`[${decision.category}] (${decision.origin}) ${decision.name.slice(0, 58)}`)
      console.log(`    ${shape}`)
      console.log(`    ${decision.evidence.slice(0, 3).join(' | ').slice(0, 150)}`)
    }
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/researchProductPorts.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
