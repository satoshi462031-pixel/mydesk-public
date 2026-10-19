import assert from 'node:assert/strict'
import test from 'node:test'
import { OPENING_WIRING_JSON } from '../src/constants/onboardingWiring.generated'
import type { MapLayout } from '../src/utils/connectionMapLayout'
import { brighten, buildOpeningScene } from '../src/utils/openingScene'

function loadLayout(): MapLayout {
  const raw = JSON.parse(OPENING_WIRING_JSON) as Omit<MapLayout, 'edges'> & {
    edges: { conn: MapLayout['edges'][number]['conn']; fromId: string; toId: string; points: { x: number; y: number }[] }[]
  }
  const byId = new Map(raw.nodes.map(n => [n.id, n]))
  return {
    ...raw,
    edges: raw.edges.map(e => ({ conn: e.conn, from: byId.get(e.fromId)!, to: byId.get(e.toId)!, points: e.points })),
  }
}

const numbersIn = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
const pairsIn = (d: string) => {
  const n = numbersIn(d)
  return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[i * 2], y: n[i * 2 + 1] }))
}

test('オープニングは焼いた配線図の機材と配線を、キーボード以外すべて、枠なしのアイコンと線で描く', () => {
  const layout = loadLayout()
  const scene = buildOpeningScene(layout)
  const keyboardEdges = layout.edges.filter(e => e.from.gadget.category === 'Keyboard' || e.to.gadget.category === 'Keyboard')
  assert.equal(scene.nodes.length, layout.nodes.length - 1)
  assert.equal(scene.wires.length, layout.edges.length - keyboardEdges.length)
  assert.deepEqual(
    scene.nodes.map(n => n.category).sort(),
    layout.nodes.map(n => n.gadget.category).filter(c => c !== 'Keyboard').sort(),
  )
  assert.equal(scene.nodes.filter(n => n.outlet).length, 1)
})

test('PCはノートPCの絵で、ヘッドホンはPCの左、マウスは右、モニターは上にある', () => {
  const scene = buildOpeningScene(loadLayout())
  const at = (category: string) => scene.nodes.find(n => n.category === category)!
  assert.equal(at('PC').pcFormFactor, 'laptop')
  assert.ok(scene.nodes.filter(n => n.category !== 'PC').every(n => n.pcFormFactor === undefined))
  assert.ok(at('Headphone').cx < at('PC').cx)
  assert.ok(at('Mouse').cx > at('PC').cx)
  assert.ok(at('Monitor').cy < at('PC').cy)
  assert.equal(scene.nodes.some(n => n.category === 'Keyboard'), false)
})

test('線はコンセントから短い順に出ている機材から伸び、電源タップからの電源は同時に伸ばし、輪になる映像線を最後に通す', () => {
  const scene = buildOpeningScene(loadLayout())
  const cables = scene.wires.map(w => w.cable)
  assert.equal(cables[0], 'Power')
  assert.equal(cables.filter(c => c === 'Power').length, 3)
  const strip = scene.nodes.find(n => n.category === 'PowerStrip' && !n.outlet)!
  const pc = scene.nodes.find(n => n.category === 'PC')!
  const monitor = scene.nodes.find(n => n.category === 'Monitor')!
  // 電源タップが出たら、PCとモニターへの電源が同じ時刻に伸び始める
  const fromStrip = scene.wires.filter(w => w.cable === 'Power' && w !== scene.wires[0])
  assert.equal(fromStrip.length, 2)
  assert.ok(Math.abs(fromStrip[0].start - fromStrip[1].start) < 1e-9, '電源タップからの電源が同時に伸びていない')
  assert.ok(fromStrip[0].start >= strip.arrive)
  assert.ok(monitor.arrive > pc.arrive)
  // 最後の1本は、モニター以外の機材に線が着いたあとに残る PC→モニターの映像線
  const last = scene.wires.at(-1)!
  assert.notEqual(last.cable, 'Power')
  assert.ok(scene.nodes.filter(n => n !== monitor).every(n => n.arrive <= last.start))
  // モニターへの電源と映像線は同時に着く
  const monitorPower = fromStrip.reduce((a, b) => (a.length > b.length ? a : b))
  assert.ok(Math.abs(monitorPower.end - last.end) < 1e-9, 'モニターへの2本が同時に着いていない')
  assert.ok(monitor.arrive < last.end)
  assert.ok(monitor.arrive + 0.08 < last.end, 'モニターは配線完了より前に表示と拡大を終える')
  const sequential = scene.wires.filter(w => !fromStrip.includes(w) || w === fromStrip.reduce((a, b) => (a.end < b.end ? a : b)))
  sequential.slice(1).forEach((wire, i) => assert.ok(Math.abs(wire.start - sequential[i].end) < 1e-9, '線は順に、切れ目なく引く'))
  assert.ok(scene.wires[0].start >= 0.28 - 1e-9 && last.end <= 0.7 + 1e-9)
  const outlet = scene.nodes.find(n => n.outlet)!
  assert.equal(outlet.arrive, 0)
  assert.ok(scene.nodes.filter(n => !n.outlet).every(n => n.arrive > 0))
})

test('線はアイコンの中に入らず、端はアイコンの手前で止まる', () => {
  const scene = buildOpeningScene(loadLayout())
  const inside = (p: { x: number; y: number }, n: (typeof scene.nodes)[number], pad: number) =>
    p.x > n.cx - n.size / 2 + pad && p.x < n.cx + n.size / 2 - pad && p.y > n.cy - n.size / 2 + pad && p.y < n.cy + n.size / 2 - pad
  for (const wire of scene.wires) {
    const points = pairsIn(wire.d)
    for (const node of scene.nodes) {
      for (const p of points) assert.equal(inside(p, node, -5), false, `${wire.cable} の線が ${node.category} のアイコンに入っている`)
    }
    for (const end of [points[0], points.at(-1)!]) {
      const gap = Math.min(...scene.nodes.map(n => Math.max(
        Math.abs(end.x - n.cx) - n.size / 2, Math.abs(end.y - n.cy) - n.size / 2)))
      assert.ok(gap > 0 && gap < 8, `線の端がアイコンに着いていない（隙間 ${gap}）`)
    }
  }
})

test('描画の領域はアイコンと線をすべて含む', () => {
  const scene = buildOpeningScene(loadLayout())
  for (const n of scene.nodes) {
    assert.ok(n.cx - n.size / 2 >= 0 && n.cx + n.size / 2 <= scene.width)
    assert.ok(n.cy - n.size / 2 >= 0 && n.cy + n.size / 2 <= scene.height)
  }
  for (const wire of scene.wires) for (const p of pairsIn(wire.d)) {
    assert.ok(p.x >= 0 && p.x <= scene.width && p.y >= 0 && p.y <= scene.height)
  }
})

test('PCが図の真ん中にあり、全体が小さくまとまっている', () => {
  const scene = buildOpeningScene(loadLayout())
  const pc = scene.nodes.find(n => n.category === 'PC')!
  assert.ok(Math.abs(pc.cx - scene.width / 2) <= 1 && Math.abs(pc.cy - scene.height / 2) <= 1, 'PCが中央にない')
  assert.ok(scene.width <= 400 && scene.height <= 480, `図が大きい（${scene.width}×${scene.height}）`)
  // モニターの電源は機材の外側を回り、他の線と交差しない
  const monitor = scene.nodes.find(n => n.category === 'Monitor')!
  const loop = scene.wires.filter(w => w.cable === 'Power').reduce((a, b) => (a.length > b.length ? a : b))
  assert.ok(pairsIn(loop.d).some(p => p.x < Math.min(...scene.nodes.map(n => n.cx - n.size / 2))), '電源の輪が機材の外側を通っていない')
  assert.ok(pairsIn(loop.d).some(p => Math.abs(p.y - monitor.cy) < 1), '電源の線がモニターに着いていない')
})

test('間隔を詰めても、アイコンは重ならず、線は見える長さを保つ', () => {
  const scene = buildOpeningScene(loadLayout())
  scene.nodes.forEach((a, i) => scene.nodes.slice(i + 1).forEach(b => {
    const gapX = Math.abs(a.cx - b.cx) - (a.size + b.size) / 2
    const gapY = Math.abs(a.cy - b.cy) - (a.size + b.size) / 2
    assert.ok(Math.max(gapX, gapY) >= 12, `${a.category} と ${b.category} が近すぎる`)
  }))
  for (const wire of scene.wires) assert.ok(wire.length - 8 >= 20, `${wire.cable} の線が短すぎる（${wire.length - 8}）`)
})

test('暗い色は色相を保ったまま明るくなり、緑系・すでに明るい色・色指定でない値は動かない', () => {
  const lightness = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(x => x / 255)
    return (Math.max(...v) + Math.min(...v)) / 2
  }
  const hue = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    return r > g && r > b ? 'red' : g > r && g > b ? 'green' : b > r && b > g ? 'blue' : 'neutral'
  }
  for (const dark of ['#000000', '#B71C1C', '#0D47A1', '#A08A00', '#555555']) {
    const out = brighten(dark)
    assert.match(out, /^#[0-9a-f]{6}$/)
    assert.ok(lightness(out) > lightness(dark) + 0.1, `${dark} → ${out} が明るくならない`)
    assert.equal(hue(out), hue(dark))
  }
  assert.notEqual(brighten('#000000'), '#000000')
  for (const green of ['#0B8043', '#00A650', '#087F5B']) assert.equal(brighten(green), green)
  assert.equal(brighten('#E9E9EF'), '#E9E9EF')
  assert.equal(brighten('#FFFFFF'), '#FFFFFF')
  assert.equal(brighten('rgb(0,0,0)'), 'rgb(0,0,0)')
})
