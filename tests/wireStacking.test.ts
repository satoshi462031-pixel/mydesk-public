import assert from 'node:assert/strict'
import test from 'node:test'
import { CableType } from '../src/types'
import { WIRE_CASING_WIDTH, WIRE_CROSSING_CUT_WIDTH } from '../src/constants/wiring'
import { branchJunctionsForDrawing, crossingCutPath, crossingCutsForDrawing, sortEdgesForDrawing } from '../src/utils/wireStacking'

const edge = (id: string, cableType: CableType, length: number, isPairLink = false) => ({
  id,
  conn: { cableType },
  points: [{ x: 0, y: 0 }, { x: length, y: 0 }],
  isPairLink,
})

test('無線・アーム → 電源 → 信号線の順に下から積む', () => {
  const sorted = sortEdgesForDrawing([
    edge('hdmi', 'HDMI', 10),
    edge('power', 'Power', 10),
    edge('bt', 'Bluetooth', 10),
    edge('usb', 'USB_C', 10),
    edge('arm', 'MonitorArm', 10),
  ])
  assert.deepEqual(sorted.map((e) => e.id), ['bt', 'arm', 'power', 'hdmi', 'usb'])
})

test('同じ層では長い線ほど下に敷く', () => {
  const sorted = sortEdgesForDrawing([
    edge('short', 'Power', 50),
    edge('long', 'Power', 400),
    edge('mid', 'Power', 120),
  ])
  assert.deepEqual(sorted.map((e) => e.id), ['long', 'mid', 'short'])
})

test('スピーカー対の破線は種類に関わらず最下層', () => {
  const sorted = sortEdgesForDrawing([
    edge('audio', 'Audio3_5mm', 10),
    edge('pair', 'Audio3_5mm', 10, true),
  ])
  assert.deepEqual(sorted.map((e) => e.id), ['pair', 'audio'])
})

test('層も長さも同じなら元の順を保ち、入力は変えない', () => {
  const input = [edge('a', 'HDMI', 10), edge('b', 'USB_C', 10)]
  const sorted = sortEdgesForDrawing(input)
  assert.deepEqual(sorted.map((e) => e.id), ['a', 'b'])
  assert.notEqual(sorted, input)
})

const branch = (id: string, points: [number, number][], group: string | undefined = 'split') => ({
  conn: { cableType: 'USB_C' as CableType, branchGroupId: group },
  from: { id: 'source' }, to: { id },
  points: points.map(([x, y]) => ({ x, y })),
})
const junctionPoints = (edges: ReturnType<typeof branch>[]) =>
  [...branchJunctionsForDrawing(edges).values()].flat().map(({ x, y }) => [x, y])

test('同一ケーブルの共通幹線から分かれる点だけに印を付ける', () => {
  const a = branch('a', [[0, 0], [80, 0], [80, 40]])
  const b = branch('b', [[0, 0], [40, 0], [40, -40]])
  const marks = branchJunctionsForDrawing([a, b])
  assert.deepEqual(marks.get(b), [{ x: 40, y: 0 }])
  assert.equal(marks.has(a), false)
})

test('別ケーブルの交差や接触には印を付けない', () => {
  const a = branch('a', [[0, 0], [80, 0]], 'one')
  const b = branch('b', [[40, -40], [40, 40]], 'two')
  assert.deepEqual(junctionPoints([a, b]), [])
  b.points = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }]
  assert.deepEqual(junctionPoints([a, b]), [])
})

test('同一グループでも共有ノードが一意でない場合や端点が離れている場合は印を付けない', () => {
  const a = branch('a', [[0, 0], [80, 0]])
  const b = branch('b', [[0, 0], [40, 0], [40, 40]])
  b.from.id = 'other'
  assert.deepEqual(junctionPoints([a, b]), [])
  b.from.id = 'source'
  b.to.id = 'a'
  assert.deepEqual(junctionPoints([a, b]), [])
  b.to.id = 'b'
  b.points[0] = { x: 0, y: 10 }
  assert.deepEqual(junctionPoints([a, b]), [])
})

test('逆向きの枝・重複点・幹線途中の折れ点を扱う', () => {
  const a = branch('a', [[0, 0], [0, 0], [20, 0], [80, 0]])
  const b = branch('b', [[40, 40], [40, 0], [0, 0]])
  b.from.id = 'b'
  b.to.id = 'source'
  assert.deepEqual(junctionPoints([a, b]), [[40, 0]])
})

test('同じ枝が再交差しても最初の分岐点だけを示す', () => {
  const a = branch('a', [[0, 0], [80, 0], [80, 80]])
  const b = branch('b', [[0, 0], [40, 0], [40, 40], [100, 40]])
  assert.deepEqual(junctionPoints([a, b]), [[40, 0]])
})

test('3本の分岐は最後に描く枝に印を1つ割り当てる', () => {
  const a = branch('a', [[0, 0], [80, 0]])
  const b = branch('b', [[0, 0], [40, 0], [40, 40]])
  const c = branch('c', [[0, 0], [40, 0], [40, -40]])
  const marks = branchJunctionsForDrawing([a, b, c])
  assert.equal(marks.size, 1)
  assert.equal(marks.get(c)?.length, 1)
  assert.deepEqual(marks.get(c), [{ x: 40, y: 0 }])
  assert.deepEqual(branchJunctionsForDrawing([a, b]).get(b), [{ x: 40, y: 0 }])
})

test('ノード直上の分岐・完全に一致した経路・装飾線には印を付けない', () => {
  const a = branch('a', [[0, 0], [80, 0]])
  const b = branch('b', [[0, 0], [0, 40]])
  assert.deepEqual(junctionPoints([a, b]), [])
  b.points = [...a.points]
  assert.deepEqual(junctionPoints([a, b]), [])
  b.points = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }]
  b.conn.cableType = 'Bluetooth'
  assert.deepEqual(junctionPoints([a, b]), [])
})

const wire = (id: string, points: [number, number][], extra: { group?: string; isPairLink?: boolean } = {}) => ({
  id,
  conn: { cableType: 'USB_C' as CableType, branchGroupId: extra.group },
  points: points.map(([x, y]) => ({ x, y })),
  isPairLink: extra.isPairLink,
})

test('交差点では上に描く線へ切れ目を割り当て、下の線の切れ目を縁取りより広げる', () => {
  const lower = wire('lower', [[100, -100], [100, 100]])
  const upper = wire('upper', [[0, 0], [200, 0]])
  const cuts = crossingCutsForDrawing([lower, upper])
  assert.equal(cuts.has(lower), false)
  assert.deepEqual(cuts.get(upper), [{ x: 100, y: 0, horizontal: true, halfWidth: WIRE_CROSSING_CUT_WIDTH / 2 }])
  assert.ok(WIRE_CROSSING_CUT_WIDTH > WIRE_CASING_WIDTH)
  // 上の線に沿って引き、太さ（＝下の線に沿った長さ）で切る
  assert.equal(crossingCutPath(cuts.get(upper)![0]), `M${100 - WIRE_CASING_WIDTH / 2} 0H${100 + WIRE_CASING_WIDTH / 2}`)
  const vertical = crossingCutsForDrawing([upper, lower]).get(lower)![0]
  assert.equal(crossingCutPath(vertical), `M100 ${-WIRE_CASING_WIDTH / 2}V${WIRE_CASING_WIDTH / 2}`)
})

test('端どうしの接触・平行な線・同じ分岐ケーブルの枝・スピーカー対の破線には切れ目を入れない', () => {
  const base = wire('base', [[0, 0], [200, 0]], { group: 'split' })
  assert.equal(crossingCutsForDrawing([base, wire('touch', [[100, 0], [100, 100]])]).size, 0)
  assert.equal(crossingCutsForDrawing([base, wire('end', [[200, -50], [200, 50]])]).size, 0)
  assert.equal(crossingCutsForDrawing([base, wire('parallel', [[0, 20], [200, 20]])]).size, 0)
  assert.equal(crossingCutsForDrawing([base, wire('sibling', [[100, -50], [100, 50]], { group: 'split' })]).size, 0)
  assert.equal(crossingCutsForDrawing([wire('pair', [[100, -50], [100, 50]], { isPairLink: true }), base]).size, 0)
})

test('下の線の端（機器の口）の近くでは切れ目を狭め、口まで届かせない', () => {
  const upper = wire('upper', [[0, 0], [200, 0]])
  const near = crossingCutsForDrawing([wire('lower', [[100, -10], [100, 100]]), upper]).get(upper)![0]
  assert.ok(near.halfWidth <= 10 - 3 && near.halfWidth > WIRE_CASING_WIDTH / 2)
  // 縁取りの切れ目より狭くなるなら、広げる意味が無いので切れ目を足さない
  assert.equal(crossingCutsForDrawing([wire('lower', [[100, -7], [100, 100]]), upper]).size, 0)
})

test('複数の線と交わる線には、交差ごとに切れ目を割り当てる', () => {
  const trunk = wire('trunk', [[0, 0], [0, 300]])
  const a = wire('a', [[-50, 100], [50, 100]])
  const b = wire('b', [[-50, 200], [50, 200], [50, 250]])
  const cuts = crossingCutsForDrawing([trunk, a, b])
  assert.deepEqual([...cuts.values()].flat().map(({ x, y }) => [x, y]), [[0, 100], [0, 200]])
})
