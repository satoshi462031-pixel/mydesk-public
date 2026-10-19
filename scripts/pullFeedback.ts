/**
 * アプリ内フィードバックを手元の台帳に取り込み、分析用のレポートを書き出す（DB は読むだけ）。
 *
 *   npm run feedback:pull
 *
 * 出力（どちらも .feedback/ で gitignore 済み）
 *   ledger.json   台帳。取り込んだ全件と「束」（同じ不満・同じ不具合のまとまり）を持つ。
 *                 振り分けと状態の更新は /feedback（.claude/commands/feedback.md）が書き込む
 *   <日時>.md     今回の新着の詳細と、要確認・未分類の持ち越し・束の一覧
 *
 * /admin は新しい20件しか出さず対応済みの印も無いので、件数が増えると古いものが見えなくなる。
 * DB に状態列を足すほどの件数ではないうちは、状態を手元の台帳に持つ。
 * 取り込み位置だけで管理すると、分析しきれなかった件が次から見えなくなり、
 * 同じ要望が時期を分けて届いても件数が積み上がらないため、全件を台帳に残す。
 *
 * 再現の手がかり（直前の操作・OS・どのバンドルか）は送信時にアプリが context に入れる（094）。
 * PostHog から引く方式は、解析がオプトインで既定オフのため大半の報告で空になるので採らない。
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ClusterStatus,
  describeEnvironment,
  describeTrail,
  FeedbackContext,
  findRegressions,
  Ledger,
  LedgerItem,
  parseLedger,
} from './feedbackLedger'
import { loadEnv } from './importRakuten'
import { secureHttpUrl } from '../src/utils/secureTransport'
import { timeoutFetch } from '../src/utils/timeoutFetch'

loadEnv()

const OUT_DIR = resolve(process.cwd(), '.feedback')
const LEDGER_PATH = resolve(OUT_DIR, 'ledger.json')

const CATEGORY_LABEL: Record<string, string> = { bug: '不具合', request: '要望', other: 'その他' }
const STATUS_LABEL: Record<ClusterStatus, string> = {
  open: '対応する', watching: '様子見', done: '対応済み', wontfix: '対応しない',
}

type FeedbackRow = {
  id: string
  user_id: string | null
  category: string
  body: string
  app_version: string | null
  platform: string | null
  context: FeedbackContext | null
  created_at: string
}

function writeLedger(ledger: Ledger): void {
  // 書きかけで落ちても台帳が半端な JSON にならないよう、別名で書いてから差し替える
  const tmp = `${LEDGER_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8')
  renameSync(tmp, LEDGER_PATH)
}

// ─── Supabase 側の文脈 ───────────────────────────────────────────

type UserContext = { accountCreatedAt?: string; desks: number; publicDesks: number }

async function fetchUserContext(db: SupabaseClient, userId: string): Promise<UserContext> {
  const [{ data: authUser }, { data: desks, error }] = await Promise.all([
    db.auth.admin.getUserById(userId),
    db.from('desks').select('visibility').eq('user_id', userId),
  ])
  if (error) throw error
  const rows = (desks ?? []) as { visibility: string }[]
  return {
    accountCreatedAt: authUser?.user?.created_at,
    desks: rows.length,
    publicDesks: rows.filter((d) => d.visibility === 'public').length,
  }
}

// ─── 出力 ────────────────────────────────────────────────────────

const jst = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })

function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000)
}

const quote = (body: string) => body.split(/\r?\n/).map((l) => `> ${l}`)

function renderNewItem(id: string, item: LedgerItem, user: UserContext | null): string {
  const lines = [
    `### ${CATEGORY_LABEL[item.category] ?? item.category}｜${jst(item.createdAt)}`,
    '',
    `- id: \`${id}\``,
    `- 環境: ${describeEnvironment(item)}`,
  ]
  if (!item.userId) {
    lines.push('- 送信者: 不明（退会済み、または匿名送信の時期のもの）')
  } else if (user) {
    const age = user.accountCreatedAt ? `登録から${daysBetween(user.accountCreatedAt, item.createdAt)}日` : '登録日不明'
    lines.push(`- 送信者: \`${item.userId}\`（${age}・デスク${user.desks}件うち公開${user.publicDesks}件）`)
  }
  lines.push('', ...quote(item.body), '', ...describeTrail(item), '')
  return lines.join('\n')
}

function renderClusters(ledger: Ledger): string[] {
  const entries = Object.entries(ledger.clusters)
  if (entries.length === 0) return ['まだ束は無い。', '']
  const order: ClusterStatus[] = ['open', 'watching', 'done', 'wontfix']
  const rows = entries.map(([key, c]) => {
    const items = Object.values(ledger.items).filter((it) => it.cluster === key)
    const people = new Set(items.map((it) => it.userId ?? `anon:${it.createdAt}`)).size
    const latest = items.reduce((m, it) => (it.createdAt > m ? it.createdAt : m), '')
    return { key, c, people, count: items.length, latest }
  }).sort((a, b) => order.indexOf(a.c.status) - order.indexOf(b.c.status) || b.people - a.people)

  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')
  return [
    '| 束 | 種類 | 状態 | 人 | 件 | 最新 | 修正 | メモ |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map(({ key, c, people, count, latest }) =>
      `| \`${key}\` ${cell(c.title)} | ${CATEGORY_LABEL[c.kind] ?? c.kind} | ${STATUS_LABEL[c.status] ?? c.status} | `
      + `${people} | ${count} | ${latest ? jst(latest).split(' ')[0] : '—'} | `
      + `${c.commit ? `${c.commit}${c.fixedIn ? ` → v${c.fixedIn}` : ''}` : '—'} | ${cell(c.note)} |`),
    '',
  ]
}

async function main(): Promise<void> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      '.env に EXPO_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定する\n' +
      '  feedback は送信者本人しか読めない RLS（031）なので anon キーでは読めない',
    )
  }

  // 取り込み前に台帳を読む。壊れていたら DB に触る前に止める
  const ledger = parseLedger(existsSync(LEDGER_PATH) ? readFileSync(LEDGER_PATH, 'utf8') : null)
  const db = createClient(secureHttpUrl(url).href, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timeoutFetch },
  })

  let query = db.from('feedback')
    .select('id, user_id, category, body, app_version, platform, context, created_at')
    .order('created_at', { ascending: true })
  if (ledger.lastCreatedAt) query = query.gte('created_at', ledger.lastCreatedAt)
  const { data, error } = await query
  if (error) {
    // context 列は 094 で足した。本番に当てる前に打つとここで止まる
    if (/context/.test(error.message)) throw new Error(`${error.message}\n  094_feedback_context.sql を本番に当ててから打ち直す`)
    throw error
  }
  // 取り込み位置と同時刻の行を取りこぼさないよう gte で取り、取り込み済みは id で除く
  const rows = ((data ?? []) as FeedbackRow[]).filter((f) => !ledger.items[f.id])

  const now = new Date()
  // ファイル名は日本時間で揃える（見出しの日時と食い違わないように）
  const stamp = new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const reportName = `${stamp}.md`

  const newSections: string[] = []
  for (const f of rows) {
    const item: LedgerItem = {
      createdAt: f.created_at,
      category: f.category,
      body: f.body,
      appVersion: f.app_version,
      platform: f.platform,
      userId: f.user_id,
      context: f.context,
      cluster: null,
      report: reportName,
    }
    const user = f.user_id ? await fetchUserContext(db, f.user_id).catch(() => null) : null
    newSections.push(renderNewItem(f.id, item, user))
    ledger.items[f.id] = item
  }
  if (rows.length > 0) ledger.lastCreatedAt = rows[rows.length - 1].created_at

  const newIds = new Set(rows.map((f) => f.id))
  const carried = Object.entries(ledger.items).filter(([id, it]) => it.cluster === null && !newIds.has(id))
  const regressions = findRegressions(ledger)
  const unknownClusters = [...new Set(Object.values(ledger.items)
    .map((it) => it.cluster).filter((c): c is string => c !== null && !ledger.clusters[c]))]

  if (rows.length === 0 && carried.length === 0 && regressions.length === 0 && unknownClusters.length === 0) {
    console.log('新着も未分類の持ち越しも無い')
    return
  }

  const summary = Object.entries(rows.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1
    return acc
  }, {})).map(([c, n]) => `${CATEGORY_LABEL[c] ?? c} ${n}件`).join('・')

  const md: string[] = [
    `# フィードバック ${jst(now.toISOString())} 取得`,
    '',
    `新着 ${rows.length}件${summary ? `（${summary}）` : ''}・未分類の持ち越し ${carried.length}件。`
    + '振り分けは `/feedback` で行い、結果は ledger.json に書く。',
    '',
  ]
  if (regressions.length > 0 || unknownClusters.length > 0) {
    md.push('## 要確認', '')
    const ids = (list: string[]) => list.map((id) => `\`${id}\``).join(', ')
    for (const r of regressions) {
      if (r.yes.length > 0) md.push(`- 再発の疑い: \`${r.key}\`（修正後のアプリから ${r.yes.length}件: ${ids(r.yes)}）`)
      if (r.unknown.length > 0) {
        md.push(`- 修正の前後を判定できない: \`${r.key}\`（${ids(r.unknown)}）。バンドルの情報が無く、版番号も修正版と同じ`)
      }
    }
    for (const k of unknownClusters) md.push(`- 台帳に無い束のキー: \`${k}\``)
    md.push('')
  }
  if (newSections.length > 0) md.push('## 新着', '', ...newSections)
  if (carried.length > 0) {
    md.push('## 未分類の持ち越し', '')
    for (const [id, it] of carried) {
      md.push(`### ${CATEGORY_LABEL[it.category] ?? it.category}｜${jst(it.createdAt)}（初出 ${it.report}）`, '',
        `- id: \`${id}\``, `- 環境: ${describeEnvironment(it)}`, '', ...quote(it.body), '', ...describeTrail(it), '')
    }
  }
  md.push('## 束の一覧', '', ...renderClusters(ledger))

  mkdirSync(OUT_DIR, { recursive: true })
  const outPath = resolve(OUT_DIR, reportName)
  writeFileSync(outPath, md.join('\n'), 'utf8')
  // レポートを書けてから台帳を進める。先に進めると、書き出しに失敗した回の新着が詳細なしで残る
  if (rows.length > 0) writeLedger(ledger)
  const regressionCount = regressions.filter((r) => r.yes.length > 0).length
  console.log(`新着 ${rows.length}件・持ち越し ${carried.length}件・再発の疑い ${regressionCount}束 → ${outPath}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
