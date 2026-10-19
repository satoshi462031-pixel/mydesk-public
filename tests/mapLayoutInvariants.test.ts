import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllDemoDesks, BuiltDemoDesk } from '../src/constants/demoDesks'
import { Gadget, MapConnection } from '../src/types'
import { computeMapLayout, MapLayout, MapNode, wiringMapGadgets } from '../src/utils/connectionMapLayout'

// computeMapLayout の出力が「どのデスクでも守るべき性質」を、実データ（デモデスク）で留める。
//
// 座標そのものは固定しない。LAYOUT_VERSION が何十回も上がっているように、見た目の調整で
// 座標が変わるのは正常で、座標を期待値に持つと変えるたびに中身を見ずに更新するだけの
// テストになる。ここで止めたいのは、どんな調整でも起きてはいけない壊れ方だけ：
//   - 同じ入力で結果が変わる（レイアウトのキャッシュ・オンボーディングの事前計算が前提にしている）
//   - ガジェットや線が図から消える
//   - ノード同士が重なる / 線の端がノードから離れる / 図がキャンバスからはみ出す

// 画面（WiringResultScreen / ConnectionMap）と同じ入力の作り方。
// ケーブル（持ち物としての登録）は配線図に渡さない
const inputsOf = (built: BuiltDemoDesk) => ({
  gadgets: built.activeGadgets.filter((g) => g.category !== 'Cable'),
  connections: built.plan.connectionMap?.connections ?? [],
  placements: built.plan.placements,
  centerPrimaryDevices: !!built.plan.templateId,
})

const layoutOf = (
  built: BuiltDemoDesk,
  override: { gadgets?: Gadget[]; connections?: MapConnection[] } = {},
) => {
  const input = inputsOf(built)
  return computeMapLayout(
    override.gadgets ?? input.gadgets,
    override.connections ?? input.connections,
    input.placements,
    {},
    {},
    input.centerPrimaryDevices,
  )
}

// MapNode は gadget を丸ごと持ち、MapEdge の from/to は nodes と同じ実体を指すので、
// 比較には位置と経路だけを抜き出す
const nodePlacement = (layout: MapLayout) =>
  [...layout.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, tier: n.tier }))

const fingerprint = (layout: MapLayout) => ({
  nodes: nodePlacement(layout),
  edges: layout.edges.map((e) => ({ conn: e.conn.id, from: e.from.id, to: e.to.id, points: e.points })),
  width: layout.width,
  height: layout.height,
  bounds: layout.bounds,
})

const overlaps = (a: MapNode, b: MapNode) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// 端点はノードの辺の上に来る。辺の上で丸め誤差を許す
const EDGE_TOLERANCE = 1
const touches = (p: { x: number; y: number }, n: MapNode) =>
  p.x >= n.x - EDGE_TOLERANCE && p.x <= n.x + n.w + EDGE_TOLERANCE
  && p.y >= n.y - EDGE_TOLERANCE && p.y <= n.y + n.h + EDGE_TOLERANCE

function assertWellFormed(layout: MapLayout, gadgets: Gadget[], connections: MapConnection[]) {
  // ガジェットが図から消えていない。独立ノードにならないもの（タブレットに付くペン等）は
  // 親ノードの attached に入る。配線を持たない家具・小物と飾りは表示対象外。
  const shown = new Set<string>()
  for (const n of layout.nodes) {
    shown.add(n.gadget.id)
    for (const a of n.attached ?? []) shown.add(a.id)
  }
  for (const g of wiringMapGadgets(gadgets, connections)) {
    assert.ok(shown.has(g.id), `${g.category} "${g.name}" が図にない`)
  }

  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]
      const b = layout.nodes[j]
      assert.ok(!overlaps(a, b), `ノードが重なっている: ${a.id} / ${b.id}`)
    }
  }

  for (const n of layout.nodes) {
    assert.ok(n.x >= 0 && n.y >= 0, `${n.id} がキャンバスの左上からはみ出している`)
    assert.ok(n.x + n.w <= layout.width && n.y + n.h <= layout.height, `${n.id} がキャンバスからはみ出している`)
  }

  // 線が消えていない。タブレットに付くペンのように線の代わりにバッジで示すものは除く
  const attachedIds = new Set(layout.nodes.flatMap((n) => (n.attached ?? []).map((a) => a.id)))
  const routed = new Set(layout.edges.map((e) => e.conn.id))
  for (const c of connections) {
    if (attachedIds.has(c.fromGadgetId) || attachedIds.has(c.toGadgetId)) continue
    assert.ok(routed.has(c.id), `${c.cableType} の線（${c.fromGadgetId} → ${c.toGadgetId}）が描かれていない`)
  }

  for (const e of layout.edges) {
    assert.ok(e.points.length >= 2, `${e.conn.id} の経路が点1つ以下`)
    for (const p of e.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${e.conn.id} の経路に数値でない点がある`)
    }
    if (e.isPairLink) continue
    assert.ok(touches(e.points[0], e.from), `${e.conn.cableType} の始点が ${e.from.id} から離れている`)
    assert.ok(touches(e.points[e.points.length - 1], e.to), `${e.conn.cableType} の終点が ${e.to.id} から離れている`)
  }
}

const demos = (['ja', 'en'] as const).flatMap((lang) =>
  buildAllDemoDesks(lang).map((built) => ({ lang, built })))

describe('computeMapLayout invariants (demo desks)', () => {
  for (const { lang, built } of demos) {
    const label = `${built.plan.name} (${lang})`

    it(`${label}: 同じ入力から同じレイアウトになる`, async () => {
      const first = await layoutOf(built)
      const second = await layoutOf(built)
      assert.deepEqual(fingerprint(second), fingerprint(first))
    })

    it(`${label}: 全ガジェット・全配線が図に載り、重なり・はみ出しがない`, async () => {
      const { gadgets, connections } = inputsOf(built)
      assertWellFormed(await layoutOf(built), gadgets, connections)
    })

    // 端末や同期の都合で配列の順が変わっても、ノードの位置は動かない。
    // 線の経路は接続の順に通り道を確保するので順に依存する（docs/engineering-improvements.md）。
    // そちらを固定すると現状で落ちるため、ここではノードの位置だけを見る
    it(`${label}: ノードの位置は入力の並び順に依存しない`, async () => {
      const { gadgets, connections } = inputsOf(built)
      const base = nodePlacement(await layoutOf(built))
      const reversedGadgets = nodePlacement(await layoutOf(built, { gadgets: [...gadgets].reverse() }))
      const reversedConnections = nodePlacement(await layoutOf(built, { connections: [...connections].reverse() }))
      assert.deepEqual(reversedGadgets, base)
      assert.deepEqual(reversedConnections, base)
    })

    it(`${label}: どこにも繋がっていないガジェットも図に置かれる`, async () => {
      const { gadgets, connections } = inputsOf(built)
      const loose: Gadget = {
        id: 'invariant-loose-mouse',
        name: 'loose mouse',
        category: 'Mouse',
        ports: [],
        createdAt: '2026-09-30T00:00:00.000Z',
      }
      const withLoose = [...gadgets, loose]
      const layout = await layoutOf(built, { gadgets: withLoose })
      assert.ok(layout.nodes.some((n) => n.gadget.id === loose.id), '繋がっていないガジェットが図にない')
      assertWellFormed(layout, withLoose, connections)
    })
  }

  it('ガジェットが0台でも落ちずに空の図を返す', async () => {
    const layout = await computeMapLayout([], [])
    assert.equal(layout.nodes.length, 0)
    assert.equal(layout.edges.length, 0)
  })
})
