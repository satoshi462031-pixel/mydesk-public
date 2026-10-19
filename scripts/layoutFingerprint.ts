/**
 * computeMapLayout の出力を固定の入力群で計算し、ケースごとの指紋（ハッシュ）を JSON で書き出す。
 * 「見た目を変えずに速くする」変更の前後で出力が1点も変わっていないことを確かめるための道具。
 *
 *   npx tsx scripts/layoutFingerprint.ts tmp/before.json            # 変更前に書き出す
 *   npx tsx scripts/layoutFingerprint.ts tmp/after.json --compare=tmp/before.json
 *
 * 入力群：デモデスク（日英・保存済みの線）/ 合成 10〜200台（自動の線）/
 * デモデスクのノードを乱数（固定の種）で動かし・大きさを変えたもの（手で動かした図・
 * ノードが重なって通路が塞がれた図＝救済経路・探索打ち切りの経路も通す）。
 * 200台は1回で数十秒〜2分かかる。--quick で100台以上を外す。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildAllDemoDesks, BuiltDemoDesk } from '../src/constants/demoDesks'
import { DeskPlan, Gadget, GadgetPlacement, MapConnection, NodeOffset } from '../src/types'
import { computeMapLayout, MapLayout, reconcileMap } from '../src/utils/connectionMapLayout'

const args = process.argv.slice(2)
const outPath = args.find((a) => !a.startsWith('--'))
const comparePath = args.find((a) => a.startsWith('--compare='))?.slice('--compare='.length)
const quick = args.includes('--quick')
if (!outPath) {
  console.error('使い方: npx tsx scripts/layoutFingerprint.ts <出力.json> [--compare=<比較元.json>] [--quick]')
  process.exit(1)
}

const AT = '2026-09-30T00:00:00.000Z'
let seed = 20260930
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

type Case = {
  name: string
  gadgets: Gadget[]
  connections: MapConnection[]
  placements: GadgetPlacement[]
  offsets: Record<string, NodeOffset>
  sizes: Record<string, { w: number; h: number }>
  center: boolean
}

const fromDemo = (built: BuiltDemoDesk, name: string): Case => ({
  name,
  gadgets: built.activeGadgets.filter((g) => g.category !== 'Cable'),
  connections: built.plan.connectionMap?.connections ?? [],
  placements: built.plan.placements,
  offsets: {},
  sizes: {},
  center: !!built.plan.templateId,
})

const planOf = (gadgets: Gadget[], placements: GadgetPlacement[]): DeskPlan => ({
  id: 'fingerprint', name: 'fingerprint', goal: 'first_setup',
  selectedGadgetIds: gadgets.map((g) => g.id), placements,
  outletCount: 2, outletCountVersion: 2, createdAt: AT, updatedAt: AT,
})

// scripts/benchLayout.ts と同じ作り方（デモデスクのガジェットを順に複製）
const synthetic = (size: number, demos: BuiltDemoDesk[]): Case => {
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
  return {
    name: `synthetic:${size}`, gadgets, placements,
    connections: reconcileMap([], gadgets, planOf(gadgets, placements)),
    offsets: {}, sizes: {}, center: false,
  }
}

const perturbed = (base: Case, k: number): Case => {
  const offsets: Record<string, NodeOffset> = {}
  const sizes: Record<string, { w: number; h: number }> = {}
  for (const g of base.gadgets) {
    if (rnd() < 0.5) offsets[g.id] = { dx: Math.round((rnd() - 0.5) * 600), dy: Math.round((rnd() - 0.5) * 400) }
    if (rnd() < 0.25) sizes[g.id] = { w: 80 + Math.round(rnd() * 220), h: 60 + Math.round(rnd() * 160) }
  }
  return { ...base, name: `${base.name}#moved${k}`, offsets, sizes }
}

// 位置・大きさ・経路・キャンバス。gadget 丸ごとは比べない（入力そのものなので）
const fingerprint = (layout: MapLayout) => createHash('sha1').update(JSON.stringify({
  nodes: layout.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h, n.tier, n.isWall, n.sideLabel ?? null]),
  edges: layout.edges.map((e) => [e.conn.id, e.from.id, e.to.id, e.points, !!e.isPairLink]),
  size: [layout.width, layout.height],
  bounds: layout.bounds,
})).digest('hex')

async function main() {
  const demosJa = buildAllDemoDesks('ja')
  const demosEn = buildAllDemoDesks('en')
  const cases: Case[] = [
    ...demosJa.map((b) => fromDemo(b, `demo:${b.plan.id}:ja`)),
    ...demosEn.map((b) => fromDemo(b, `demo:${b.plan.id}:en`)),
    ...[10, 20, 30, 50, ...(quick ? [] : [100, 200])].map((n) => synthetic(n, demosJa)),
  ]
  for (const b of demosJa) {
    const base = fromDemo(b, `demo:${b.plan.id}:ja`)
    for (let k = 0; k < 15; k++) cases.push(perturbed(base, k))
  }
  const synth20 = synthetic(20, demosJa)
  for (let k = 0; k < 5; k++) cases.push(perturbed(synth20, k))

  const out: Record<string, string> = {}
  const t0 = Date.now()
  for (const c of cases) {
    const layout = await computeMapLayout(c.gadgets, c.connections, c.placements, c.offsets, c.sizes, c.center)
    out[c.name] = fingerprint(layout)
  }
  writeFileSync(outPath!, JSON.stringify(out, null, 1))
  console.log(`${cases.length} ケース / ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outPath}`)

  if (comparePath) {
    const before: Record<string, string> = JSON.parse(readFileSync(comparePath, 'utf8'))
    const diff = Object.keys(out).filter((k) => before[k] !== out[k])
    const missing = Object.keys(before).filter((k) => !(k in out))
    if (diff.length || missing.length) {
      console.log(`一致しない: ${diff.length} 件 ${diff.slice(0, 20).join(', ')}`)
      if (missing.length) console.log(`比較元にだけある: ${missing.join(', ')}`)
      process.exit(1)
    }
    console.log(`全 ${Object.keys(out).length} ケースが比較元と一致`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
