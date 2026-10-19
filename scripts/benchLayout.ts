/**
 * 配線図の生成（配線の決定 → 配置・経路）にかかる時間を測る。
 *
 *   npm run bench:layout                     # 現実的な規模だけ（デモデスク・〜30台）
 *   npm run bench:layout -- --stress         # 50 / 100 / 200 台も測る
 *   npm run bench:layout:profile -- --profile=30
 *       指定した台数の computeMapLayout を CPU プロファイルし、自分の中で時間を使った関数（self time）の
 *       上位を出す。tsx 経由だと変換後のコードが1行にまとまり全関数が同じ位置に潰れるので、
 *       esbuild で tmp/ へ束ねてから node で走らせる（出る行番号は束ねたファイルの行）
 *
 * レイアウトのコードには手を入れず、外から測る。
 *   - wall：computeMapLayout の開始から終了まで（画面が図を待つ時間）
 *   - cpu ：測定区間のプロセス全体のCPU時間（process.cpuUsage）。JIT・GCなども含む。
 *   - 最大イベントループ間隔：1msタイマーの実行間隔。計算末尾の未実行区間も含む。
 *           OSのタイマー精度にも影響され、wall - cpu をすべてyield待ちとは見なせない。
 * Node（V8）の値は相対比較に使う。Hermesでの絶対値や描画を含む操作感は、
 * 実機の開発ビルドの `[perf] layout` ログと画面操作で別途確かめる。
 *
 * 合成デスクはデモデスク3件のガジェットを順に複製して作る。プリセットの商品は電源タップ・充電器・
 * PC の口を持たないものが多く、そこから組むと実在しない（線がほとんど無い）デスクになるため。
 * 複製したデスクは PC・電源タップを台数に比例して持つ「デスクを何台分か並べた」形になる。
 */
import { readFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { fileURLToPath } from 'node:url'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { DeskPlan, Gadget, GadgetPlacement, MapConnection } from '../src/types'
import { computeMapLayout, MapLayout, MapLayoutCancelled, reconcileMap } from '../src/utils/connectionMapLayout'

type Case = {
  name: string
  kind: 'real' | 'stress'
  gadgets: Gadget[]
  placements: GadgetPlacement[]
  /** 保存済みの接続（デモデスク）。無ければ自動の配線を作って使う */
  connections?: MapConnection[]
  centerPrimaryDevices: boolean
}

type Result = {
  name: string
  kind: Case['kind']
  gadgets: number
  nodes: number
  edges: number
  wiringMs: number
  wallMs: number[]
  cpuMs: number[]
  eventLoopGapMs: number[]
  timedOut: boolean
}

const args = process.argv.slice(2)
const withStress = args.includes('--stress')
const profileSize = Number(args.find((a) => a.startsWith('--profile='))?.slice('--profile='.length) ?? NaN)
// 1回がこれを超えたら打ち切る（200台で帰ってこない場合に備える）
const TIMEOUT_MS = 120_000
const AT = '2026-09-30T00:00:00.000Z'

const demos = buildAllDemoDesks('ja')

const planOf = (name: string, gadgets: Gadget[], placements: GadgetPlacement[]): DeskPlan => ({
  id: `bench-${name}`,
  name,
  goal: 'first_setup',
  selectedGadgetIds: gadgets.map((g) => g.id),
  placements,
  outletCount: 2,
  outletCountVersion: 2,
  createdAt: AT,
  updatedAt: AT,
})

const demoCases = (): Case[] =>
  demos.map((built) => ({
    name: `demo:${built.plan.name}`,
    kind: 'real',
    gadgets: built.activeGadgets.filter((g) => g.category !== 'Cable'),
    placements: built.plan.placements,
    connections: built.plan.connectionMap?.connections ?? [],
    centerPrimaryDevices: !!built.plan.templateId,
  }))

// デモデスクを順に並べ、id を付け替えて size 台に切る。設置場所も一緒に写す
const synthetic = (size: number, kind: Case['kind']): Case => {
  const gadgets: Gadget[] = []
  const placements: GadgetPlacement[] = []
  for (let round = 0; gadgets.length < size; round++) {
    for (const built of demos) {
      const zoneOf = new Map(built.plan.placements.map((p) => [p.gadgetId, p.zone]))
      for (const g of built.activeGadgets) {
        if (g.category === 'Cable' || gadgets.length >= size) continue
        const id = `b${round}-${g.id}`
        gadgets.push({ ...g, id, createdAt: AT })
        const zone = zoneOf.get(g.id)
        if (zone) placements.push({ gadgetId: id, zone })
      }
    }
  }
  return { name: `synthetic:${size}台`, kind, gadgets, placements, centerPrimaryDevices: false }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const fmt = (ms: number) => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1))

async function layoutOnce(c: Case, connections: MapConnection[]) {
  const deadline = performance.now() + TIMEOUT_MS
  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  let lastTick = t0, eventLoopGap = 0
  // wall が短くても、制御を返さない長い区間があれば操作は止まる。
  const timer = setInterval(() => {
    const now = performance.now()
    eventLoopGap = Math.max(eventLoopGap, now - lastTick)
    lastTick = now
  }, 1)
  try {
    const layout = await computeMapLayout(
      c.gadgets, connections, c.placements, {}, {}, c.centerPrimaryDevices,
      () => performance.now() > deadline,
    )
    const wall = performance.now() - t0
    const cpu = process.cpuUsage(cpu0)
    eventLoopGap = Math.max(eventLoopGap, performance.now() - lastTick)
    return { layout, wall, cpu: (cpu.user + cpu.system) / 1000, eventLoopGap }
  } finally {
    clearInterval(timer)
  }
}

async function measure(c: Case, runs: number): Promise<Result> {
  const w0 = performance.now()
  const connections = c.connections ?? reconcileMap([], c.gadgets, planOf(c.name, c.gadgets, c.placements))
  const wiringMs = performance.now() - w0
  const base = { name: c.name, kind: c.kind, gadgets: c.gadgets.length, wiringMs }
  let layout: MapLayout | undefined
  const wallMs: number[] = []
  const cpuMs: number[] = []
  const eventLoopGapMs: number[] = []
  try {
    // 1回目は JIT の暖機を含むので捨てる（画面では2回目以降の計算も多い：編集・履歴アニメ）
    ;({ layout } = await layoutOnce(c, connections))
    for (let i = 0; i < runs; i++) {
      const r = await layoutOnce(c, connections)
      layout = r.layout
      wallMs.push(r.wall)
      cpuMs.push(r.cpu)
      eventLoopGapMs.push(r.eventLoopGap)
    }
  } catch (e) {
    if (!(e instanceof MapLayoutCancelled)) throw e
    return { ...base, nodes: 0, edges: connections.length, wallMs, cpuMs, eventLoopGapMs, timedOut: true }
  }
  return { ...base, nodes: layout!.nodes.length, edges: layout!.edges.length, wallMs, cpuMs, eventLoopGapMs, timedOut: false }
}

async function profile(c: Case) {
  const connections = c.connections ?? reconcileMap([], c.gadgets, planOf(c.name, c.gadgets, c.placements))
  await layoutOnce(c, connections)   // 暖機
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', { interval: 100 })
  await session.post('Profiler.start')
  for (let i = 0; i < 3; i++) await layoutOnce(c, connections)
  const { profile: prof } = await session.post('Profiler.stop')
  session.disconnect()

  // サンプルの間隔（timeDeltas）をノードごとに足して self time にする
  const selfUs = new Map<number, number>()
  prof.samples!.forEach((id, i) => selfUs.set(id, (selfUs.get(id) ?? 0) + (prof.timeDeltas![i] ?? 0)))
  // 束ねたファイルでは関数名が __name 越しになり (anonymous) と出るので、定義行の書き出しを添えて引けるようにする
  const sourceLines = new Map<string, string[]>()
  const lineOf = (url: string, line: number) => {
    if (!url.startsWith('file://')) return ''
    if (!sourceLines.has(url)) {
      try { sourceLines.set(url, readFileSync(fileURLToPath(url), 'utf8').split('\n')) } catch { sourceLines.set(url, []) }
    }
    return (sourceLines.get(url)![line] ?? '').trim().slice(0, 48).replace(/\|/g, '\\|')
  }
  const byFn = new Map<string, number>()
  let total = 0
  for (const n of prof.nodes) {
    const us = selfUs.get(n.id) ?? 0
    total += us
    const f = n.callFrame
    const file = f.url.replace(/^.*[\\/]/, '')
    const key = `${f.functionName || '(anonymous)'} ${file}:${f.lineNumber + 1}\` \`${lineOf(f.url, f.lineNumber)}`
    byFn.set(key, (byFn.get(key) ?? 0) + us)
  }
  const top = [...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  console.log(`\n### CPU プロファイル: ${c.name}（${c.gadgets.length}台・3回分・self time 上位）\n`)
  console.log('| 関数 | self ms | 割合 |')
  console.log('|---|---:|---:|')
  for (const [key, us] of top) {
    console.log(`| \`${key}\` | ${fmt(us / 1000)} | ${((us / total) * 100).toFixed(1)}% |`)
  }
}

async function main() {
  console.log(`Node ${process.version} / ${process.platform} ${process.arch}`)

  if (Number.isFinite(profileSize)) {
    await profile(synthetic(profileSize, profileSize > 30 ? 'stress' : 'real'))
    return
  }

  const cases: [Case, number][] = [
    ...demoCases().map((c) => [c, 5] as [Case, number]),
    ...[10, 20, 30].map((n) => [synthetic(n, 'real'), 5] as [Case, number]),
    ...(withStress ? [[synthetic(50, 'stress'), 3], [synthetic(100, 'stress'), 1], [synthetic(200, 'stress'), 1]] as [Case, number][] : []),
  ]

  console.log('\n| 区分 | ケース | ガジェット | ノード | 配線 | 配線の決定 ms | レイアウト wall ms（中央値） | process CPU ms（中央値） | 最大イベントループ間隔 ms | 回数 |')
  console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const [c, runs] of cases) {
    const r = await measure(c, runs)
    const wall = r.timedOut ? `> ${TIMEOUT_MS / 1000}s（打ち切り）` : fmt(median(r.wallMs))
    const cpu = r.timedOut ? '—' : fmt(median(r.cpuMs))
    const wiring = c.connections ? '（保存済み）' : fmt(r.wiringMs)
    const gap = r.timedOut ? '—' : fmt(Math.max(...r.eventLoopGapMs))
    console.log(`| ${r.kind === 'real' ? '現実的' : 'ストレス'} | ${r.name} | ${r.gadgets} | ${r.nodes} | ${r.edges} | ${wiring} | ${wall} | ${cpu} | ${gap} | ${r.wallMs.length} |`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
