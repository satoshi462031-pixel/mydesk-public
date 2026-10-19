/**
 * 公開デスクの統計が成立するかを確認する読み取り専用スクリプト。
 *
 *   npm run audit:public-desks
 *
 * /admin/gadgets と同じ RPC（043）を叩くだけで、書き込みは一切しない。
 * 「まだ n が足りないから作らない」を毎回同じ手順で確認できるようにするのが目的で、
 * 数か月おきに実行して停止条件が外れたかを見る。
 *
 * 出力に user_id / desk_id / device_id / デスク名 / ガジェット名は含めない。
 */

import { createClient } from '@supabase/supabase-js'
import { loadEnv } from './importRakuten'

loadEnv()

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error(
    '.env に EXPO_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定する\n' +
    '  集計RPC（043）は service_role にだけ GRANT してあるため anon キーでは叩けない',
  )
  process.exit(1)
}

// 読み取り専用で使う。セッションを持たせない
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const nf = new Intl.NumberFormat('ja-JP')
const n = (v: unknown) => (v == null ? '—' : nf.format(Number(v)))
const pct = (a: unknown, b: unknown) =>
  !Number(b) ? '—' : `${(Number(a) / Number(b) * 100).toFixed(1)}%`

function heading(text: string): void {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 56 - text.length))}`)
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(34, ' ')}${value}`)
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await db.rpc(name, args)
  if (error) {
    console.error(`  ! ${name}: ${error.message}`)
    return null
  }
  return data as T
}

type Quality = {
  min_sample: number
  population: { public_desks: number; unique_owners: number }
  snapshot: Record<string, number>
  periods: Record<string, number>
  devices: Record<string, number>
  categories: { category: string; devices: number; owners: number }[]
  connections: Record<string, number>
  gates: Record<string, boolean | number>
}

async function main(): Promise<void> {
  console.log(`公開デスク統計の監査　${new Date().toISOString()}`)
  console.log('（読み取りのみ。DBへの書き込みは行わない）')

  const q = await rpc<Quality>('admin_gadget_data_quality')
  if (!q) {
    console.error('\nデータ品質を取得できなかったため中断する。043 が未適用の可能性がある。')
    process.exit(1)
  }

  heading('母集団')
  row('公開デスク', n(q.population.public_desks))
  row('ユニーク所有者', `${n(q.population.unique_owners)}　（MIN_SAMPLE ${n(q.min_sample)}）`)
  row('device（現在構成）', n(q.devices.devices))
  row('device（Cable 除く）', n(q.devices.devices_no_cable))
  row('category が空', n(q.devices.null_category))

  heading('share_snapshot')
  row('gadgets を持つ公開デスク', n(q.snapshot.with_snapshot))
  row('snapshot が空', n(q.snapshot.empty_snapshot))
  row('version 1', `${n(q.snapshot.version_1)}　（期間履歴・productId なし）`)
  row('version 2 以上', n(q.snapshot.version_2_plus))
  row('version 3 以上', `${n(q.snapshot.version_3_plus)}　（snapshotCapturedAt を持つ）`)
  row('保存日時あり', n(q.snapshot.with_captured_at))
  row('plan.updatedAt 欠損', n(q.snapshot.plan_updated_at_missing))
  row('snapshot 内の機器', n(q.periods.gadgets))
  row('productId あり', `${n(q.periods.with_product_id)}　${pct(q.periods.with_product_id, q.periods.gadgets)}`)

  heading('利用期間')
  row('期間の総数', n(q.periods.periods_total))
  row('active / decor', `${n(q.periods.active_periods)} / ${n(q.periods.decor_periods)}`)
  row('終了済み active（イベント）', n(q.periods.ended_active))
  row('継続中 active（打ち切り）', n(q.periods.ongoing_active))
  row('再導入（2期間目以降）', n(q.periods.reintroduced))
  row('異常値', n(q.periods.anomalies))
  row('KM 可能な観測', n(q.periods.km_usable_periods))
  row('KM 可能な所有者', n(q.periods.km_unique_owners))
  row('撤去履歴を持つデスク', n(q.periods.desks_with_removal))
  row('最終観測日時が不明', `${n(q.periods.censor_unknown)}　（継続中で snapshotCapturedAt 無し）`)

  heading('devices との比較')
  row('purchased_at 入力率', pct(q.devices.purchased_at_filled, q.devices.devices))
  row('removed_at 入力率', `${pct(q.devices.removed_at_filled, q.devices.devices)}　（撤去の正本ではない）`)
  row('price 入力率', pct(q.devices.price_filled, q.devices.devices))
  row('price 中央値', `${n(q.devices.price_median)} 円`)

  heading('カテゴリ')
  for (const c of q.categories.slice(0, 15)) {
    row(c.category ?? '(未設定)', `device ${n(c.devices)}　所有者 ${n(c.owners)}`)
  }

  heading('接続')
  row('connections', n(q.connections.total))
  row('自己接続', n(q.connections.self_link))
  row('cable_type の種類', n(q.connections.cable_types))

  // 推論を含む集計は ready フラグだけ見る。数値は画面で確認する
  const cooccurrence = await rpc<{ ready?: boolean; rows?: unknown[] }>('admin_gadget_cooccurrence')
  const connections = await rpc<{ ready?: boolean; rows?: unknown[] }>('admin_gadget_connections')

  heading('推論を含む集計')
  row('共在構成', cooccurrence?.ready ? `算出可（${cooccurrence.rows?.length ?? 0} ペア）` : 'サンプル不足')
  row('直接接続構成', connections?.ready ? `算出可（${connections.rows?.length ?? 0} ペア）` : 'サンプル不足')

  heading('停止条件の判定')
  const gates: [string, unknown][] = [
    [`ユニーク所有者が ${q.min_sample} 人以上`, q.gates.owners_ok],
    ['share_snapshot version 2 が母数の過半', q.gates.snapshot_v2_ok],
    ['終了済み active 期間が 1 件以上', q.gates.events_ok],
    [`KM 可能な所有者が ${q.min_sample} 人以上`, q.gates.km_owners_ok],
    ['期間の観測があり、そのすべてに snapshotCapturedAt がある', q.gates.censor_exact_ok],
  ]
  for (const [label, ok] of gates) row(`${ok ? '○' : '×'} ${label}`, '')

  const blocked = gates.filter(([, ok]) => !ok)
  console.log('')
  if (blocked.length === 0) {
    console.log('停止条件をすべて満たしている。推論を含む指標を公開検討の対象にしてよい。')
  } else {
    console.log('停止条件に該当中。実装に進まない。')
    for (const [label] of blocked) console.log(`  - ${label}`)
    console.log(`  あと ${n(q.gates.owners_short_by)} 人でユニーク所有者の閾値に届く。`)
  }
  console.log('\n※ 在籍継続率を公開できるのは、継続中の観測すべてに snapshotCapturedAt がある')
  console.log('   カテゴリだけ。version 2 以前の公開デスクは、再公開されると version 3 になる。')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
