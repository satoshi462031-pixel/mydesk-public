/**
 * 手動配置（自動生成では到達しない配置）を含む配線図をランダム生成し、
 * computeMapLayout の不変条件を総当たりで検証する。
 *
 * 自動下書きのままの構成は compareMapLayoutMetrics.ts が見ているので、
 * こちらは「ユーザーがノードを動かした・大きさを変えた・手で線を足した」状態を狙う。
 *
 *   npx tsx scripts/fuzzManualLayout.ts [件数] [--seed=N] [--shard=i/N]
 */
import { fork } from 'node:child_process'
import os from 'node:os'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { GADGET_PRESETS } from '../src/constants/gadgetPresets'
import { CABLE_SORT_ORDER } from '../src/constants/portTypes'
import type { CableType, DeskPlan, DeskZone, Gadget, MapConnection } from '../src/types'
import {
  computeMapLayout,
  NODE_MAX,
  NODE_MIN,
  POWER_SOURCE_IDS,
  reconcileMap,
  type MapLayout,
  type MapNode,
} from '../src/utils/connectionMapLayout'

// yieldToEventLoop の setTimeout(0) は Node では最低 1ms 待つ。1万件では待ち時間が
// 支配的になるため、0ms 指定だけマイクロタスクへ差し替える（計算内容は変えない）。
const realSetTimeout = globalThis.setTimeout
;(globalThis as unknown as { setTimeout: unknown }).setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  if (!ms) { queueMicrotask(() => fn(...args)); return 0 }
  return realSetTimeout(fn, ms, ...(args as []))
}) as typeof setTimeout

// ─── 決定論的乱数（seed から丸ごと再現できるようにする）─────────────
type Rng = () => number
const makeRandom = (seed: number): Rng => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
}
const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length]
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))

const ZONES: DeskZone[] = [
  'back_left', 'back_center', 'back_right', 'front_left', 'front_center', 'front_right',
  'desk_left', 'desk_right', 'under_desk', 'desk_back',
]

const demos = buildAllDemoDesks('ja')
const presetPool = GADGET_PRESETS
const demoGadgetPool = demos.flatMap((d) => d.gadgets)
const POWER_IDS = [...POWER_SOURCE_IDS]

type FuzzCase = {
  seed: number
  label: string
  gadgets: Gadget[]
  plan: DeskPlan
  connections: MapConnection[]
  offsets: Record<string, { dx: number; dy: number }>
  sizes: Record<string, { w: number; h: number }>
}

const splitsInTwo = (g: Gadget) =>
  (g.category === 'Speaker' && g.stereoPair === true) || (g.category === 'Keyboard' && !!g.splitKeyboard)
const nodeIdsFor = (g: Gadget): string[] =>
  splitsInTwo(g) ? [g.id + '__L', g.id + '__R'] : [g.id]

const buildCase = (seed: number): FuzzCase => {
  const rng = makeRandom(seed)
  const mode = rng()
  let gadgets: Gadget[]
  let label: string
  const zoneSrc = new Map<string, DeskZone>()

  if (mode < 0.4) {
    // ① デモデスク（実データ）の部分集合
    const demo = pick(rng, demos)
    const keep = 0.45 + rng() * 0.55
    gadgets = demo.activeGadgets.filter(() => rng() < keep)
    if (gadgets.length < 2) gadgets = demo.activeGadgets.slice(0, 3)
    for (const p of demo.plan.placements) zoneSrc.set(p.gadgetId, p.zone)
    label = `demo:${demo.demo.id}`
  } else {
    // ② プリセット商品からの合成構成（デモには無い組み合わせを踏む）
    const n = int(rng, 2, 22)
    const pool: Gadget[] = rng() < 0.25 ? demoGadgetPool : (presetPool as unknown as Gadget[])
    gadgets = []
    for (let i = 0; i < n; i++) {
      const p = pick(rng, pool)
      gadgets.push({ ...p, id: `g${i}`, createdAt: '2026-01-01T00:00:00.000Z', removedAt: undefined })
    }
    label = 'synth'
  }

  // 設置場所は一部だけ指定（未指定はカテゴリ既定ロールへ落ちる経路を通す）
  const placements = gadgets
    .filter(() => rng() < 0.75)
    .map((g) => ({ gadgetId: g.id, zone: zoneSrc.get(g.id) ?? pick(rng, ZONES) }))

  const plan: DeskPlan = {
    id: `fuzz-${seed}`,
    name: 'fuzz',
    goal: 'clean_wiring',
    selectedGadgetIds: gadgets.map((g) => g.id),
    placements,
    outletCount: int(rng, 0, 8),
    outletCountVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  // 自動下書き → ユーザーの手が入った状態へ変形する
  let connections = reconcileMap([], gadgets, plan, 'ja')
  connections = connections.filter(() => rng() > 0.15)                    // 消した線
  connections = connections.map((c) => ({ ...c, confirmed: rng() < 0.6 })) // 確定/未確定を混ぜる
  const manualCount = int(rng, 0, 4)
  const endpointIds = [...gadgets.map((g) => g.id), ...POWER_IDS]
  for (let i = 0; i < manualCount && endpointIds.length >= 2; i++) {
    const a = pick(rng, endpointIds)
    const b = pick(rng, endpointIds)
    if (a === b) continue
    connections.push({
      id: `fuzz-manual-${i}`,
      fromGadgetId: a,
      toGadgetId: b,
      cableType: pick(rng, CABLE_SORT_ORDER) as CableType,
      origin: 'manual',
      confirmed: rng() < 0.5,
      wireless: rng() < 0.2,
    })
  }

  // ── ここが本題：自動配置では絶対に生まれない位置とサイズ ──
  const offsets: FuzzCase['offsets'] = {}
  const sizes: FuzzCase['sizes'] = {}
  const targets = [...gadgets.flatMap(nodeIdsFor), ...POWER_IDS]
  const offsetRate = rng()
  const sizeRate = rng() * 0.6
  for (const id of targets) {
    if (rng() < offsetRate) {
      const span = rng() < 0.12 ? 1600 : 260   // たまに画面外まで飛ばす
      offsets[id] = {
        dx: Math.round((rng() - 0.5) * 2 * span),
        dy: Math.round((rng() - 0.5) * 2 * span * 0.7),
      }
    }
    if (rng() < sizeRate) {
      // クランプ境界の外側も入れる（保存済みデータが範囲外な場合の耐性）
      sizes[id] = rng() < 0.2
        ? { w: Math.round(rng() * 900) - 100, h: Math.round(rng() * 700) - 80 }
        : { w: int(rng, NODE_MIN, 420), h: int(rng, NODE_MIN, 360) }
    }
  }

  return { seed, label, gadgets, plan, connections, offsets, sizes }
}

// ─── 不変条件 ───────────────────────────────────────────────────
const finite = (...vals: number[]) => vals.every((v) => Number.isFinite(v))
const isAxial = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6

type Violation = { rule: string; detail: string }

const checkLayout = (c: FuzzCase, layout: MapLayout): Violation[] => {
  const out: Violation[] = []
  const add = (rule: string, detail: string) => { if (out.length < 8) out.push({ rule, detail }) }

  if (!finite(layout.width, layout.height)) add('canvas-finite', `w=${layout.width} h=${layout.height}`)
  if (!finite(layout.bounds.minX, layout.bounds.minY, layout.bounds.maxX, layout.bounds.maxY)) {
    add('bounds-finite', JSON.stringify(layout.bounds))
  }

  const ids = new Set<string>()
  for (const n of layout.nodes) {
    if (ids.has(n.id)) add('node-duplicate-id', n.id)
    ids.add(n.id)
    if (!finite(n.x, n.y, n.w, n.h, n.cx, n.cy)) {
      add('node-finite', `${n.id} x=${n.x} y=${n.y} w=${n.w} h=${n.h}`)
      continue
    }
    if (n.w <= 0 || n.h <= 0) add('node-size-positive', `${n.id} w=${n.w} h=${n.h}`)
    if (n.w > NODE_MAX + 0.5 || n.h > NODE_MAX + 0.5) add('node-size-max', `${n.id} w=${n.w} h=${n.h}`)
    if (c.sizes[n.id] && (n.w < NODE_MIN - 0.5 || n.h < NODE_MIN - 0.5)) {
      add('node-size-min', `${n.id} w=${n.w} h=${n.h} req=${JSON.stringify(c.sizes[n.id])}`)
    }
    if (Math.abs(n.cx - (n.x + n.w / 2)) > 0.51 || Math.abs(n.cy - (n.y + n.h / 2)) > 0.51) {
      add('node-center', `${n.id} x=${n.x} w=${n.w} cx=${n.cx} / y=${n.y} h=${n.h} cy=${n.cy}`)
    }
    if (n.x < layout.bounds.minX - 0.5 || n.y < layout.bounds.minY - 0.5 ||
        n.x + n.w > layout.bounds.maxX + 0.5 || n.y + n.h > layout.bounds.maxY + 0.5) {
      add('bounds-contains-node', `${n.id} node=(${n.x},${n.y},${n.w},${n.h}) bounds=${JSON.stringify(layout.bounds)}`)
    }
  }

  const near = (p: { x: number; y: number }, n: MapNode, margin: number) =>
    p.x >= n.x - margin && p.x <= n.x + n.w + margin && p.y >= n.y - margin && p.y <= n.y + n.h + margin

  const edgeIds = new Set<string>()
  for (const e of layout.edges) {
    if (e.points.length < 2) { add('edge-points', `${e.conn.id} points=${e.points.length}`); continue }
    if (!e.points.every((p) => finite(p.x, p.y))) {
      add('edge-finite', `${e.conn.id} ${JSON.stringify(e.points)}`)
      continue
    }
    if (!e.isPairLink) {
      for (let i = 1; i < e.points.length; i++) {
        if (!isAxial(e.points[i - 1], e.points[i])) {
          add('edge-axial', `${e.conn.id} seg${i} ${JSON.stringify([e.points[i - 1], e.points[i]])}`)
          break
        }
      }
      if (edgeIds.has(e.conn.id)) add('edge-duplicate-id', e.conn.id)
      edgeIds.add(e.conn.id)
    }
    const head = e.points[0]
    const tail = e.points[e.points.length - 1]
    if (!near(head, e.from, 24)) {
      add('edge-start-detached', `${e.conn.id} from=${e.from.id} p=${JSON.stringify(head)} node=(${e.from.x},${e.from.y},${e.from.w},${e.from.h})`)
    }
    if (!near(tail, e.to, 24)) {
      add('edge-end-detached', `${e.conn.id} to=${e.to.id} p=${JSON.stringify(tail)} node=(${e.to.x},${e.to.y},${e.to.w},${e.to.h})`)
    }
  }

  // 入力した接続が図から消えていないか（両端が描画対象ノードとして残っている場合）
  const nodeIds = new Set(layout.nodes.map((n) => n.id))
  const attachedIds = new Set(layout.nodes.flatMap((n) => (n.attached ?? []).map((g) => g.id)))
  const byGadget = new Map(c.gadgets.map((g) => [g.id, g]))
  const resolve = (id: string): string[] => {
    const g = byGadget.get(id)
    if (!g) return POWER_SOURCE_IDS.has(id) ? [id] : []
    return nodeIdsFor(g)
  }
  for (const conn of c.connections) {
    if (attachedIds.has(conn.fromGadgetId) || attachedIds.has(conn.toGadgetId)) continue
    if (byGadget.get(conn.fromGadgetId)?.displayOnly || byGadget.get(conn.toGadgetId)?.displayOnly) continue
    const from = resolve(conn.fromGadgetId)
    const to = resolve(conn.toGadgetId)
    if (from.length === 0 || to.length === 0) continue
    if (!from.some((id) => nodeIds.has(id)) || !to.some((id) => nodeIds.has(id))) continue
    if (!edgeIds.has(conn.id)) add('edge-missing', `${conn.id} ${conn.fromGadgetId}->${conn.toGadgetId} ${conn.cableType}`)
  }

  // 関係のないノードを線が突き抜けていないか。
  // A* が経路を見つけられないと呼び出し側が直線へ落とすので、ここに現れる
  let penetrations = 0
  for (const e of layout.edges) {
    if (e.isPairLink) continue
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1]
      const b = e.points[i]
      for (const n of layout.nodes) {
        if (n.id === e.from.id || n.id === e.to.id) continue
        if (crossesNode(a, b, n)) { penetrations++; break }
      }
    }
  }
  if (penetrations > 0) add('edge-penetrates-node', `${penetrations}区間がノードを貫通`)

  // 手で動かしても大きくもしていないノード同士が重なるのは自動配置側の破綻
  const manualIds = new Set([...Object.keys(c.offsets), ...Object.keys(c.sizes)])
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]
      const b = layout.nodes[j]
      if (manualIds.has(a.id) || manualIds.has(b.id)) continue
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox > 4 && oy > 4) add('node-overlap-auto', `${a.id} x ${b.id} 重なり=${Math.round(ox)}x${Math.round(oy)}`)
    }
  }

  return out
}

// 線分が矩形の内側を通るか（端点が辺に触れるだけは除く）
const crossesNode = (a: { x: number; y: number }, b: { x: number; y: number }, n: MapNode) => {
  const x0 = n.x + 1.5, x1 = n.x + n.w - 1.5, y0 = n.y + 1.5, y1 = n.y + n.h - 1.5
  if (x1 <= x0 || y1 <= y0) return false
  const steps = 24
  for (let k = 1; k < steps; k++) {
    const x = a.x + ((b.x - a.x) * k) / steps
    const y = a.y + ((b.y - a.y) * k) / steps
    if (x > x0 && x < x1 && y > y0 && y < y1) return true
  }
  return false
}

const layoutSignature = (l: MapLayout) => JSON.stringify([
  l.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h]),
  l.edges.map((e) => [e.conn.id, e.points]),
])

const runCase = async (seed: number, deep: boolean) => {
  const c = buildCase(seed)
  // --baseline: 同じ構成のまま手動配置だけ捨てる。手動配置に固有の症状かを切り分けるため
  if (BASELINE) { c.offsets = {}; c.sizes = {} }
  const started = Date.now()
  let layout: MapLayout
  try {
    layout = await computeMapLayout(c.gadgets, c.connections, c.plan.placements, c.offsets, c.sizes)
  } catch (error) {
    return { seed, label: c.label, ms: Date.now() - started, shape: `gadgets=${c.gadgets.length}`, violations: [{ rule: 'throw', detail: String(error) }] }
  }
  const ms = Date.now() - started
  const shape = `gadgets=${c.gadgets.length} nodes=${layout.nodes.length} edges=${layout.edges.length} offsets=${Object.keys(c.offsets).length} sizes=${Object.keys(c.sizes).length}`
  const violations = checkLayout(c, layout)
  if (deep) {
    // 同じ入力で同じ結果になるか（レイアウトキャッシュは決定論性を前提にしている）
    const again = await computeMapLayout(c.gadgets, c.connections, c.plan.placements, c.offsets, c.sizes)
    if (layoutSignature(layout) !== layoutSignature(again)) {
      violations.push({ rule: 'nondeterministic', detail: '同じ入力で異なるレイアウトが返った' })
    }
  }
  return { seed, label: c.label, ms, shape, violations }
}

// ─── 実行 ───────────────────────────────────────────────────────
type ShardResult = {
  done: number
  results: Array<{ seed: number; label: string; rule: string; detail: string }>
  slowest: { seed: number; ms: number }
}

const args = process.argv.slice(2)
const total = Number(args.find((a) => /^\d+$/.test(a)) ?? 10000)
const shardArg = args.find((a) => a.startsWith('--shard='))?.slice(8)
const baseSeed = Number(args.find((a) => a.startsWith('--seed='))?.slice(7) ?? 0x5eed01)
const SLOW_MS = Number(args.find((a) => a.startsWith('--slow='))?.slice(7) ?? 3000)
const BASELINE = args.includes('--baseline')

const runShard = async (index: number, count: number): Promise<ShardResult> => {
  const results: ShardResult['results'] = []
  let slowest = { seed: 0, ms: 0 }
  let done = 0
  for (let i = index; i < total; i += count) {
    const seed = (baseSeed + i * 2654435761) >>> 0
    const r = await runCase(seed, i % 50 === 0)
    done++
    if (r.ms > slowest.ms) slowest = { seed, ms: r.ms }
    // 配線図は開いた瞬間に出る前提の画面。数秒かかる時点で実機では破綻している
    if (r.ms > SLOW_MS) results.push({ seed, label: r.label, rule: 'slow-layout', detail: `${r.ms}ms ${r.shape}` })
    for (const v of r.violations) results.push({ seed, label: r.label, rule: v.rule, detail: v.detail })
    if (index === 0 && done % 20 === 0) {
      process.stderr.write(`  進捗(shard0) ${done} / ${Math.ceil(total / count)} 件, 違反 ${results.length}\n`)
    }
  }
  return { done, results, slowest }
}

const main = async () => {
  if (shardArg) {
    const [i, n] = shardArg.split('/').map(Number)
    const out = await runShard(i, n)
    process.send?.(out)
    return
  }
  const parallel = Math.min(12, Math.max(1, os.cpus().length - 2))
  const started = Date.now()
  console.log(`手動配置ファズ: ${total} ケース / ${parallel} プロセス / seed=${baseSeed}${BASELINE ? ' / 手動配置なし(baseline)' : ''}`)
  const shards = await Promise.all(
    Array.from({ length: parallel }, (_, i) => new Promise<ShardResult>((resolve, reject) => {
      const child = fork(process.argv[1], [String(total), `--shard=${i}/${parallel}`, `--seed=${baseSeed}`, `--slow=${SLOW_MS}`, ...(BASELINE ? ['--baseline'] : [])], {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      child.on('message', (m) => resolve(m as ShardResult))
      child.on('exit', (code) => { if (code !== 0) reject(new Error(`shard ${i} exited ${code}`)) })
    })),
  )
  const results = shards.flatMap((s) => s.results)
  const done = shards.reduce((a, s) => a + s.done, 0)
  const slowest = shards.reduce((a, s) => (s.slowest.ms > a.ms ? s.slowest : a), { seed: 0, ms: 0 })
  const byRule = new Map<string, { count: number; seeds: number[]; sample: string }>()
  for (const r of results) {
    const e = byRule.get(r.rule) ?? { count: 0, seeds: [] as number[], sample: r.detail }
    e.count++
    if (e.seeds.length < 5) e.seeds.push(r.seed)
    byRule.set(r.rule, e)
  }
  console.log(`\n完了: ${done} ケース / ${((Date.now() - started) / 1000).toFixed(1)}s / 最遅 ${slowest.ms}ms (seed=${slowest.seed})`)
  if (byRule.size === 0) { console.log('違反なし'); return }
  console.log(`違反 ${results.length} 件（${byRule.size} 種）`)
  for (const [rule, e] of [...byRule.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`\n■ ${rule}  ${e.count}件`)
    console.log(`  seeds: ${e.seeds.join(', ')}`)
    console.log(`  例: ${e.sample}`)
  }
}

export const buildFuzzCase = buildCase

// 別スクリプトから構成生成だけ借りる場合があるので、直接起動されたときだけ走らせる
if ((process.argv[1] ?? '').includes('fuzzManualLayout')) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
