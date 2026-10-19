/**
 * フィードバック台帳（.feedback/ledger.json）の型と判定。pullFeedback.ts から使い、tests/ で確かめる。
 * 台帳の運用は .claude/commands/feedback.md。
 */

export type ClusterStatus = 'open' | 'watching' | 'done' | 'wontfix'

export type LedgerItem = {
  createdAt: string
  category: string
  body: string
  appVersion: string | null
  platform: string | null
  userId: string | null
  // 送信時の環境（094 の context）。094 より前の送信は null
  context: FeedbackContext | null
  // null は未分類。/feedback が束のキーを入れる
  cluster: string | null
  report: string
}

export type Cluster = {
  title: string
  kind: 'bug' | 'request' | 'other'
  status: ClusterStatus
  note?: string
  // 修正のコミットの時刻（ISO）。再発の判定に使う
  fixedAt?: string
  // 修正を含む最初のストアの版。「新機能」の下書きに使う
  fixedIn?: string
  commit?: string
}

export type Ledger = {
  lastCreatedAt?: string
  items: Record<string, LedgerItem>
  clusters: Record<string, Cluster>
}

type TrailEntry = { s: number; screen?: string; failure?: string; operation?: string; code?: string }

// 形は src/services/feedbackService.ts の buildContext
export type FeedbackContext = {
  os?: string
  pad?: boolean
  lang?: string
  theme?: string
  plan?: string
  bundle?: { id?: string | null; createdAt?: string | null; embedded?: boolean; channel?: string | null } | null
  trail?: TrailEntry[]
  crashEventId?: string
}

// 読めなかった台帳を空として扱って上書きすると、振り分けの結果が全部消える。
// 無いとき（text が null）だけ空で始め、壊れているときは例外で止める
export function parseLedger(text: string | null): Ledger {
  if (text === null) return { items: {}, clusters: {} }
  let parsed: Partial<Ledger>
  try {
    parsed = JSON.parse(text) as Partial<Ledger>
  } catch (e) {
    throw new Error(`台帳が JSON として読めない。直してから打ち直す（上書きはしない）\n${String(e)}`)
  }
  if (!parsed || typeof parsed.items !== 'object' || !parsed.items
    || typeof parsed.clusters !== 'object' || !parsed.clusters) {
    throw new Error('台帳に items / clusters が無い。直してから打ち直す（上書きはしない）')
  }
  return parsed as Ledger
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 対応済みの束に届いた報告が、修正の入ったアプリから来たか。
 *
 * 版番号では決められない。ネイティブ構成が同じなら修正は同じ版番号の
 * OTA 更新でも届き、同じ 1.0.0 に直す前と直した後のバンドルが混在する。
 * そこで送信時に動いていた JS バンドルの作成時刻（ストアのビルドに埋め込まれたものは
 * ビルド時刻）を修正のコミット時刻と比べる。バンドルの情報が無い送信（094 より前・
 * 開発ビルド）だけ版番号で判定し、同じ版なら決められないので unknown を返す。
 */
export function regressionStatus(item: LedgerItem, cluster: Cluster): 'yes' | 'no' | 'unknown' {
  if (cluster.status !== 'done') return 'no'
  const bundleAt = item.context?.bundle?.createdAt
  if (bundleAt && cluster.fixedAt) return Date.parse(bundleAt) > Date.parse(cluster.fixedAt) ? 'yes' : 'no'
  if (item.appVersion && cluster.fixedIn) {
    const d = compareVersion(item.appVersion, cluster.fixedIn)
    if (d > 0) return 'yes'
    if (d < 0) return 'no'
  }
  return 'unknown'
}

export function findRegressions(ledger: Ledger): { key: string; yes: string[]; unknown: string[] }[] {
  const out: { key: string; yes: string[]; unknown: string[] }[] = []
  for (const [key, cluster] of Object.entries(ledger.clusters)) {
    if (cluster.status !== 'done') continue
    const yes: string[] = []
    const unknown: string[] = []
    for (const [id, item] of Object.entries(ledger.items)) {
      if (item.cluster !== key) continue
      const r = regressionStatus(item, cluster)
      if (r === 'yes') yes.push(id)
      else if (r === 'unknown') unknown.push(id)
    }
    if (yes.length > 0 || unknown.length > 0) out.push({ key, yes, unknown })
  }
  return out
}

const shortDate = (iso: string) => iso.slice(0, 16).replace('T', ' ')

export function describeEnvironment(item: LedgerItem): string {
  const ctx = item.context
  const os = `${item.platform ?? '?'}${ctx?.os ? ` ${ctx.os}` : ''}${ctx?.pad ? '（iPad）' : ''}`
  const parts = [os, `v${item.appVersion ?? '?'}`]
  if (ctx?.bundle) {
    const b = ctx.bundle
    const at = b.createdAt ? shortDate(b.createdAt) : '時刻不明'
    parts.push(b.embedded ? `ビルド埋め込み（${at} UTC）` : `OTA ${b.id?.slice(0, 8) ?? '?'}（${at} UTC）`)
  } else if (ctx) {
    parts.push('バンドル不明（開発ビルド）')
  }
  if (ctx) parts.push([ctx.lang, ctx.theme, ctx.plan].filter(Boolean).join('・'))
  return parts.join(' / ')
}

export function describeTrail(item: LedgerItem): string[] {
  const ctx = item.context
  if (!ctx) return ['直前の操作: 無し（送信時の環境を持つ前の送信）']
  const lines: string[] = []
  if (!ctx.trail) {
    lines.push('直前の操作: 添付なし（本人が選ばなかった）')
  } else if (ctx.trail.length === 0) {
    lines.push('直前の操作: 添付あり・記録なし（起動直後に送信した）')
  } else {
    lines.push('直前の操作（古い順・送信の何秒前か）:', '```')
    for (const e of ctx.trail) {
      const what = e.screen
        ? `画面 ${e.screen}`
        : `失敗 ${e.failure}${e.operation ? ` operation=${e.operation}` : ''}${e.code ? ` code=${e.code}` : ''}`
      lines.push(`${String(-e.s).padStart(6)}秒  ${what}`)
    }
    lines.push('```')
  }
  if (ctx.crashEventId) lines.push(`Sentry の直近の事象: \`${ctx.crashEventId}\``)
  return lines
}
