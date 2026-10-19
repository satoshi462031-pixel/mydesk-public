import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import type { Gadget, GadgetPlacement, MapConnection, NodeOffset } from '../src/types'
import { computeMapLayout, MAP_CLEAR, type MapLayout } from '../src/utils/connectionMapLayout'

type Point = { x: number; y: number }

async function layoutOf(name: string) {
  const input = JSON.parse(readFileSync(`tests/fixtures/routing-${name}.json`, 'utf8')) as {
    gadgets: Gadget[]
    connections: MapConnection[]
    placements: GadgetPlacement[]
    offsets: Record<string, NodeOffset>
    sizes: Record<string, { w: number; h: number }>
  }
  return computeMapLayout(input.gadgets, input.connections, input.placements, input.offsets, input.sizes)
}

function crossings(first: Point[], second: Point[]) {
  let count = 0
  for (let i = 1; i < first.length; i++) for (let j = 1; j < second.length; j++) {
    const a = first[i - 1], b = first[i], c = second[j - 1], d = second[j]
    const horizontal = Math.abs(a.y - b.y) < 0.5
    if (horizontal === (Math.abs(c.y - d.y) < 0.5)) continue
    const [h0, h1, v0, v1] = horizontal ? [a, b, c, d] : [c, d, a, b]
    if (v0.x > Math.min(h0.x, h1.x) + 1 && v0.x < Math.max(h0.x, h1.x) - 1
      && h0.y > Math.min(v0.y, v1.y) + 1 && h0.y < Math.max(v0.y, v1.y) - 1) count++
  }
  return count
}

function assertClear(layout: MapLayout) {
  for (const edge of layout.edges) {
    if (edge.isPairLink) continue
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i]
      assert.ok(Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5, '配線を斜めにしない')
      for (const node of layout.nodes) {
        const own = node.id === edge.from.id || node.id === edge.to.id
        const margin = own ? -0.5 : MAP_CLEAR - 0.5
        const intersects = Math.max(a.x, b.x) > node.x - margin
          && Math.min(a.x, b.x) < node.x + node.w + margin
          && Math.max(a.y, b.y) > node.y - margin
          && Math.min(a.y, b.y) < node.y + node.h + margin
        assert.equal(intersects, false, `${edge.conn.id} が ${node.id} に食い込む`)
      }
    }
  }
}

test('機器と並走線を避けながら、実用構成の階段状の5曲がりを3曲がり以下にまとめる', async () => {
  // auditMapLayout の seed=20260802 / real #48。通路の両端をL字で結ぶだけでは整理できない。
  const layout = await layoutOf('staircase')
  const edge = layout.edges.find((e) => e.conn.id === 'map-auto-14')!
  assert.ok(edge)
  let bends = 0
  for (let i = 1; i < edge.points.length - 1; i++) {
    if ((Math.abs(edge.points[i - 1].x - edge.points[i].x) < 0.5)
      !== (Math.abs(edge.points[i].x - edge.points[i + 1].x) < 0.5)) bends++
  }
  assert.ok(bends <= 3, `不要な階段状の迂回が残る: ${bends}曲がり`)
  for (const other of layout.edges) {
    if (other === edge || other.isPairLink) continue
    for (let i = 1; i < edge.points.length; i++) for (let j = 1; j < other.points.length; j++) {
      const a = edge.points[i - 1], b = edge.points[i], c = other.points[j - 1], d = other.points[j]
      const horizontal = Math.abs(a.y - b.y) < 0.5
      if (horizontal !== (Math.abs(c.y - d.y) < 0.5)) continue
      const axis = horizontal ? 'x' : 'y'
      const gap = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x)
      const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
        - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
      assert.ok(gap >= 11.5 || overlap <= 0.5, `${other.conn.id} との並走間隔を維持する`)
    }
  }
  assertClear(layout)
})

test('迂回の短縮で、同じ機器から出る別の配線との交差を新しく作らない', async () => {
  // auditMapLayout の seed=20260802 / plain #10。交差合計だけでは口元の絡みを見逃す。
  const layout = await layoutOf('crossing')
  const first = layout.edges.find((e) => e.conn.id === 'map-auto-10')!
  const second = layout.edges.find((e) => e.conn.id === 'map-auto-11')!
  assert.ok(first && second)
  assert.equal(crossings(first.points, second.points), 0)
  assertClear(layout)
})

for (const lang of ['ja', 'en'] as const) {
  test(`交差補修後も1本の接続点は中央に揃え、複数本の接続点は分ける (${lang})`, async () => {
    const demo = buildAllDemoDesks(lang).find((built) => built.demo.id === 'demo-gaming')!
    for (const centerPrimary of [false, true]) {
      const layout = await computeMapLayout(
        demo.activeGadgets.filter((g) => g.category !== 'Cable'),
        demo.plan.connectionMap!.connections, demo.plan.placements, {}, {}, centerPrimary,
      )
      const keyboard = layout.nodes.find((n) => n.gadget.category === 'Keyboard')!
      const edge = layout.edges.find((e) => e.from.id === keyboard.id || e.to.id === keyboard.id)!
      const point = edge.from.id === keyboard.id ? edge.points[0] : edge.points[edge.points.length - 1]
      const horizontalSide = Math.abs(point.y - keyboard.y) < 0.5 || Math.abs(point.y - keyboard.y - keyboard.h) < 0.5
      assert.ok(Math.abs(horizontalSide ? point.x - keyboard.cx : point.y - keyboard.cy) <= 0.5,
        '交差を解消するために接続点を角へ押し戻さない')
      const terminals = new Map<string, Point[]>()
      for (const wire of layout.edges) {
        if (wire.isPairLink) continue
        for (const [node, endpoint] of [[wire.from, wire.points[0]], [wire.to, wire.points[wire.points.length - 1]]] as const) {
          const existing = terminals.get(node.id) ?? []
          for (const other of existing) {
            assert.ok(Math.hypot(endpoint.x - other.x, endpoint.y - other.y) >= 13.5,
              `${node.id}: 複数本の接続点を中央へ集めない`)
          }
          terminals.set(node.id, [...existing, endpoint])
        }
      }
      assertClear(layout)
    }
  })
}
