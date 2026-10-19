import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { computeMapLayout, dragEdgePoints, patchLayoutNodeMove, type MapLayout, type MapNode } from '../src/utils/connectionMapLayout'

function assertConnectedOutsideNodes(layout: MapLayout) {
  const onBoundary = (p: { x: number; y: number }, n: MapNode) =>
    ((Math.abs(p.x - n.x) < 0.5 || Math.abs(p.x - n.x - n.w) < 0.5) && p.y >= n.y && p.y <= n.y + n.h)
    || ((Math.abs(p.y - n.y) < 0.5 || Math.abs(p.y - n.y - n.h) < 0.5) && p.x >= n.x && p.x <= n.x + n.w)
  for (const edge of layout.edges) {
    if (edge.isPairLink) continue
    assert.ok(onBoundary(edge.points[0], layout.nodes.find(n => n.id === edge.from.id)!), `${edge.conn.id}: 始点が機材から離れている`)
    assert.ok(onBoundary(edge.points.at(-1)!, layout.nodes.find(n => n.id === edge.to.id)!), `${edge.conn.id}: 終点が機材から離れている`)
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i]
      const horizontal = Math.abs(a.y - b.y) < 0.5
      assert.ok(horizontal || Math.abs(a.x - b.x) < 0.5, `${edge.conn.id}: 斜めの区間がある`)
      for (const node of layout.nodes) {
        const enters = horizontal
          ? a.y > node.y + 0.5 && a.y < node.y + node.h - 0.5
            && Math.min(a.x, b.x) < node.x + node.w - 0.5 && Math.max(a.x, b.x) > node.x + 0.5
          : a.x > node.x + 0.5 && a.x < node.x + node.w - 0.5
            && Math.min(a.y, b.y) < node.y + node.h - 0.5 && Math.max(a.y, b.y) > node.y + 0.5
        assert.equal(enters, false, `${edge.conn.id}: ${node.id} を貫通している`)
      }
    }
  }
}

test('コンセントをタップの上へ移動するとき、接続先へ折り返す仮配線を採用しない', async () => {
  const demo = buildAllDemoDesks('ja')[1]
  const gadgets = demo.activeGadgets.filter(g => g.category !== 'Cable')
  const connections = demo.plan.connectionMap!.connections
  const base = await computeMapLayout(gadgets, connections, demo.plan.placements)
  assert.ok(patchLayoutNodeMove(base, 'wall', 300, -220) === null)
  const wall = base.nodes.find(n => n.id === 'wall')!
  const moved = await computeMapLayout(gadgets, connections, demo.plan.placements, {
    wall: { dx: 300, dy: -220, bx: Math.round(wall.baseX!), by: Math.round(wall.baseY!) },
  })
  assert.equal(moved.edges.length, base.edges.length)
  assertConnectedOutsideNodes(moved)
})

test('実デスクの機材を前後左右へ動かしても、採用する仮配線が機材を貫通しない', async () => {
  for (const demo of buildAllDemoDesks('ja').slice(0, 2)) {
    const base = await computeMapLayout(demo.activeGadgets.filter(g => g.category !== 'Cable'), demo.plan.connectionMap!.connections, demo.plan.placements)
    let accepted = 0
    for (const node of base.nodes.slice(0, 8)) {
      for (const [dx, dy] of [[8, 0], [0, 8], [140, 60], [-140, 100], [100, -140], [-100, -100]]) {
        const patch = patchLayoutNodeMove(base, node.id, dx, dy)
        if (!patch) continue
        accepted++
        assertConnectedOutsideNodes(patch.layout)
        assert.equal(patch.layout.edges.length, base.edges.length)
      }
    }
    assert.ok(accepted > 0, '安全な移動は仮配線を利用できる')
  }
})

test('移動後の仮配線が別の線へ重なるときは全体を引き直して線を分ける', async () => {
  const demo = buildAllDemoDesks('ja')[0]
  const gadgets = demo.activeGadgets.filter(g => g.category !== 'Cable')
  const connections = demo.plan.connectionMap!.connections
  const base = await computeMapLayout(gadgets, connections, demo.plan.placements)
  const id = 'demo-gaming-switch2'
  // 仮配線を採らない移動量を使う。元の配線図の経路が変わると採れる移動量も変わる
  // （LAYOUT_VERSION 67 で -64,-48 は重ならない仮配線を採れるようになった）
  const [dx, dy] = [-64, -64]
  assert.equal(patchLayoutNodeMove(base, id, dx, dy), null)
  const node = base.nodes.find(n => n.id === id)!
  const moved = await computeMapLayout(gadgets, connections, demo.plan.placements, {
    [id]: { dx, dy, bx: Math.round(node.baseX!), by: Math.round(node.baseY!) },
  })
  assertConnectedOutsideNodes(moved)
  const first = moved.edges.find(e => e.conn.id === 'map-auto-1')!
  const second = moved.edges.find(e => e.conn.id === 'map-auto-13')!
  for (let i = 1; i < first.points.length; i++) for (let j = 1; j < second.points.length; j++) {
    const a = first.points[i - 1], b = first.points[i], c = second.points[j - 1], d = second.points[j]
    const horizontal = Math.abs(a.y - b.y) < 0.5
    if (horizontal !== (Math.abs(c.y - d.y) < 0.5)) continue
    const gap = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x)
    const overlap = horizontal
      ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
      : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
    assert.ok(gap >= 12 - 0.5 || overlap <= 1, '接続先が違う線を重ねない')
  }
})

test('移動で伸びた仮配線もキャンバス内へ収め、SVGの端で切れない', () => {
  const node = (id: string, x: number): MapNode => ({
    id, x, y: 100, w: 80, h: 80, cx: x + 40, cy: 140, tier: 0, isWall: false,
    gadget: { id, name: id, category: 'PC', ports: [], createdAt: '2026-10-10' },
  })
  const from = node('from', 40), to = node('to', 500)
  const base: MapLayout = {
    nodes: [from, to], width: 650, height: 300,
    bounds: { minX: 40, minY: 100, maxX: 580, maxY: 180 },
    edges: [{ from, to, conn: { id: 'wire', fromGadgetId: from.id, toGadgetId: to.id, cableType: 'USB_C', origin: 'manual', confirmed: true },
      points: [{ x: 120, y: 140 }, { x: 300, y: 140 }, { x: 300, y: 250 }, { x: 600, y: 250 }, { x: 600, y: 140 }, { x: 580, y: 140 }],
    }],
  }
  const patch = patchLayoutNodeMove(base, from.id, 500, 300)
  assert.ok(patch)
  assertConnectedOutsideNodes(patch.layout)
  for (const point of patch.layout.edges.flatMap(edge => edge.points)) {
    assert.ok(point.x >= 0 && point.x <= patch.layout.width, `x=${point.x} が図からはみ出している`)
    assert.ok(point.y >= 0 && point.y <= patch.layout.height, `y=${point.y} が図からはみ出している`)
  }
  const leavingLeft: MapLayout = { ...base, edges: [{ ...base.edges[0], points: [
    { x: 40, y: 140 }, { x: 20, y: 140 }, { x: 20, y: 250 },
    { x: 600, y: 250 }, { x: 600, y: 140 }, { x: 580, y: 140 },
  ] }] }
  assert.ok(patchLayoutNodeMove(leavingLeft, from.id, -28, 300) === null, '負座標の配線は全体再計算へ任せる')
})

test('ドラッグ中の仮経路は始点・終点・両端とペア線を追従させ、元の折れ点を変更しない', () => {
  const samples = [
    [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 100 }],
    [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 100, y: 100 }],
  ]
  for (const points of samples) {
    const before = structuredClone(points)
    for (const [from, to] of [[true, false], [false, true], [true, true], [false, false]]) {
      for (const pair of [false, true]) {
        const moved = dragEdgePoints(points, from, to, pair, 30, 40)
        assert.deepEqual(moved[0], { x: points[0].x + (from ? 30 : 0), y: points[0].y + (from ? 40 : 0) })
        assert.deepEqual(moved.at(-1), { x: points.at(-1)!.x + (to ? 30 : 0), y: points.at(-1)!.y + (to ? 40 : 0) })
        if (!pair) for (let i = 1; i < moved.length; i++) {
          assert.ok(moved[i].x === moved[i - 1].x || moved[i].y === moved[i - 1].y)
        }
      }
    }
    assert.deepEqual(points, before)
    assert.deepEqual(dragEdgePoints(points, true, false, false, 0, 0), before)
  }
})
