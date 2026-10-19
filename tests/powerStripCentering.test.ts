import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetPlacement, Port } from '../src/types'
import { computeMapLayout, MapNode, reconcileMap } from '../src/utils/connectionMapLayout'

// 電源タップの段での位置を固定する回帰テスト。
//
// adjacentRank は電源タップを「並び」の先頭に置くが、それは充電器と隣り合わせるための
// 役割順であって、最終的な x 座標ではない。実際の配置は段ごとの中央寄せが決めており、
// 段に3台以上あれば電源タップは中央に来る。
// 「左端に寄って見える」のは段が2台以下で左右に振り分ける相手がいない構成に限られる。
// ここを壊すと図の重心がずれるので、現在の配置を検査で留めておく。

const port = (id: string, type: Port['type'], direction: Port['direction'], count = 1): Port =>
  ({ id, type, direction, count })

const at = '2026-09-20T00:00:00.000Z'

const strip: Gadget = {
  id: 'strip',
  name: 'power strip',
  category: 'PowerStrip',
  ports: [port('ac-in', 'Power', 'input'), port('outlets', 'Power', 'output', 6)],
  createdAt: at,
}
const charger = (id = 'charger'): Gadget => ({
  id,
  name: `usb charger ${id}`,
  category: 'Charger',
  ports: [port('ac-in', 'Power', 'input'), port('usb-c', 'USB_C', 'output', 2)],
  createdAt: at,
})
const printer = (id: string): Gadget => ({
  id,
  name: id,
  category: 'Printer3D',
  ports: [port(`${id}-ac`, 'Power', 'input')],
  powerUsage: 'continuous',
  createdAt: at,
})

const makePlan = (ids: string[], placements: GadgetPlacement[] = []): DeskPlan => ({
  id: 'strip-centering',
  name: 'strip centering',
  goal: 'clean_wiring',
  selectedGadgetIds: ids,
  placements,
  outletCount: 2,
  outletCountVersion: 2,
  createdAt: at,
  updatedAt: at,
})

async function layoutOf(gadgets: Gadget[], placements: GadgetPlacement[] = []) {
  const plan = makePlan(gadgets.map((g) => g.id), placements)
  // 自動生成の接続を配置に渡す形（MapConnection）へ均してから測る
  const connections = reconcileMap([], gadgets, plan)
  return computeMapLayout(gadgets, connections, plan.placements, {}, {}, false)
}

const rowOf = (nodes: MapNode[], target: MapNode) =>
  nodes.filter((n) => Math.abs(n.cy - target.cy) < 1).sort((a, b) => a.cx - b.cx)

const stripNode = (nodes: MapNode[]) =>
  nodes.find((n) => n.gadget.category === 'PowerStrip' && !n.isWall)!

describe('power strip centering', () => {
  // 充電器が無くても、段に3台あれば電源タップは左端ではなく中央に置かれる
  it('centres the power strip when the row has three or more gadgets', async () => {
    const gadgets = [strip, printer('printer-a'), printer('printer-b')]
    const layout = await layoutOf(gadgets)
    const target = stripNode(layout.nodes)
    const row = rowOf(layout.nodes, target)
    const index = row.findIndex((n) => n.id === target.id)

    assert.ok(row.length >= 3, `段が ${row.length} 台しかなく中央に寄せられない`)
    assert.equal(index, Math.floor(row.length / 2), '電源タップが段の中央にない')
    assert.ok(index > 0, '電源タップが左端のまま')
    assert.ok(index < row.length - 1, '電源タップが右端になった')
  })

  // 充電器が入っても電源タップは中央のまま、かつ充電器はその隣に残る
  it('keeps the charger adjacent to the power strip', async () => {
    const gadgets = [strip, charger(), printer('printer-a'), printer('printer-b')]
    const layout = await layoutOf(gadgets)
    const target = stripNode(layout.nodes)
    const row = rowOf(layout.nodes, target)
    const index = row.findIndex((n) => n.id === target.id)
    const neighbours = [row[index - 1], row[index + 1]].filter(Boolean)

    assert.equal(index, Math.floor(row.length / 2), '電源タップが段の中央にない')
    // 隣接を崩すと充電器の給電線が段を横断して伸びる（adjacentRank の意図）
    assert.ok(
      neighbours.some((n) => n.gadget.category === 'Charger'),
      '充電器が電源タップの隣から離れた',
    )
  })

  it('keeps a power cluster together when a six-device row is split', async () => {
    const gadgets = [
      strip,
      charger('charger-a'),
      charger('charger-b'),
      charger('charger-c'),
      printer('printer-a'),
      printer('printer-b'),
    ]
    const layout = await layoutOf(gadgets)
    const powerNodes = layout.nodes.filter((node) => !node.isWall && (
      node.gadget.category === 'PowerStrip' || node.gadget.category === 'Charger'
    ))

    assert.equal(new Set(powerNodes.map((node) => node.cy)).size, 1, '充電器と電源タップが別の段へ分かれた')
  })

  it('preserves an explicit charger side instead of moving it to the strip band', async () => {
    const targetCharger = charger()
    const gadgets = [strip, targetCharger, printer('printer-a')]
    const layout = await layoutOf(gadgets, [
      { gadgetId: strip.id, zone: 'desk_left' },
      { gadgetId: targetCharger.id, zone: 'desk_right' },
    ])
    const targetStripNode = stripNode(layout.nodes)
    const chargerNode = layout.nodes.find((node) => node.id === targetCharger.id)!

    assert.ok(chargerNode.cx > targetStripNode.cx, '右指定の充電器が左指定の電源タップ側へ移動した')
  })

  it('leaves the strip at the left edge when the row is too short', async () => {
    // 2台では左右に振り分ける相手がいないので左端のまま。
    // 「電源タップが端に寄って見える」のはこの構成（デモのゲーミング等）に限られる
    const gadgets = [strip, printer('printer-a')]
    const layout = await layoutOf(gadgets)
    const target = stripNode(layout.nodes)
    const row = rowOf(layout.nodes, target)

    assert.equal(row.findIndex((n) => n.id === target.id), 0)
  })
})
