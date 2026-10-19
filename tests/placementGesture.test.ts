import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { boundedPlacementPan, nearestPlacement, placementEdgeVelocity, placementMoveBounds, resolvePlacementDrag } from '../src/utils/placementGesture'
import { historyChangeLabel } from '../src/utils/historyPresentation'
import type { TimelineEvent } from '../src/utils/deskTimeline'
import type { Gadget } from '../src/types'

const node = { id: 'moving', x: 100, y: 100, w: 80, h: 60 }
const peer = { id: 'peer', x: 210, y: 220, w: 100, h: 80 }

test('配置操作のworkletはビルド後も初期化でき、依存する関数を呼び出せる', () => {
  const { transformFileSync } = createRequire(resolve('package.json'))('@babel/core')
  const { code } = transformFileSync('src/utils/placementGesture.ts', {
    plugins: ['@babel/plugin-transform-typescript', 'react-native-worklets/plugin', '@babel/plugin-transform-modules-commonjs'],
    babelrc: false, configFile: false,
  })
  const exported: Record<string, any> = {}
  runInNewContext(code, { exports: exported, global: { Error } })
  const result = exported.nearestPlacement(node, [peer], node.x, node.y)
  assert.equal(result.x, node.x)
  assert.equal(result.y, node.y)
  assert.equal(exported.resolvePlacementDrag(node, [peer], 108, 10, 6).dx, 110)
})

test('整列は中心・左右上下の同じ端で吸着し、範囲から離れると自由移動へ戻る', () => {
  const aligned = resolvePlacementDrag(node, [peer], 108, 10, 6)
  assert.equal(aligned.dx, 110)
  assert.equal(aligned.dy, 10)
  assert.equal(aligned.guideX, 210)
  assert.equal(aligned.guideY, null)
  const center = resolvePlacementDrag(node, [peer], 119, 10, 6)
  assert.equal(center.dx, 120)
  assert.equal(center.dy, 10)
  assert.equal(center.guideX, 260)
  const vertical = resolvePlacementDrag(node, [peer], 10, 131, 6)
  assert.equal(vertical.dy, 130)
  assert.equal(vertical.guideY, 260)
  const free = resolvePlacementDrag(node, [peer], 142, 155, 6)
  assert.equal(free.dx, 142)
  assert.equal(free.dy, 155)
  assert.equal(free.guideX, null)
  assert.equal(free.guideY, null)
})

test('吸着距離は画面上の6ptを基準にし、縮小表示でも同じ指の移動で外れる', () => {
  for (const scale of [0.2, 0.5, 1, 2.5]) {
    const rect = { ...node, w: 100 }
    const other = { ...peer, w: 100 }
    const near = resolvePlacementDrag(rect, [other], 110 - 5 / scale, 10, 6 / scale)
    const far = resolvePlacementDrag(rect, [other], 110 - 7 / scale, 10, 6 / scale)
    assert.equal(near.dx, 110)
    assert.equal(far.guideX, null)
  }
})

test('配置はキャンバスの負座標へ入らず、既存の距離制限内に収まる', () => {
  const result = resolvePlacementDrag(node, [peer], -1000, 20000, 6)
  assert.equal(node.x + result.dx, 28)
  assert.equal(node.y + result.dy, peer.y + peer.h + 600)
  const single = placementMoveBounds(node, [])
  assert.equal(single.minX, 28)
  assert.equal(single.maxX, node.x + 600)
})

test('画面端の自動移動は端に近いほど加速し、中央・画面外では停止する', () => {
  assert.equal(placementEdgeVelocity(150, 300), 0)
  assert.ok(placementEdgeVelocity(10, 300) > placementEdgeVelocity(40, 300))
  assert.equal(placementEdgeVelocity(0, 300), 260)
  assert.equal(placementEdgeVelocity(300, 300), -260)
  assert.equal(placementEdgeVelocity(-1, 300), 0)
  assert.equal(placementEdgeVelocity(301, 300), 0)
  assert.equal(placementEdgeVelocity(0, 0), 0)
  assert.equal(placementEdgeVelocity(10, 100), -placementEdgeVelocity(90, 100))
})

test('距離制限に達したらカメラも止まり、指が範囲外でも逆方向へ飛ばない', () => {
  assert.equal(boundedPlacementPan(98, 8, -100, 100), 100)
  assert.equal(boundedPlacementPan(-98, -8, -100, 100), -100)
  assert.equal(boundedPlacementPan(105, 8, -100, 100), 105)
  assert.equal(boundedPlacementPan(-105, -8, -100, 100), -105)
  assert.equal(boundedPlacementPan(105, -8, -100, 100), 97)
  assert.equal(boundedPlacementPan(-105, 8, -100, 100), -97)
  assert.equal(boundedPlacementPan(105, 0, -100, 100), 105)
})

test('シークの変更内容は追加・撤去・使用方法を区別し、まとめ期間と現在ページにも対応する', () => {
  const monitor = { id: 'monitor', name: 'モニター', category: 'Monitor' } as Gadget
  const keyboard = { id: 'keyboard', name: 'キーボード', category: 'Keyboard' } as Gadget
  const event = { inGadgets: [monitor], outGadgets: [keyboard], modeChanges: [] } as unknown as TimelineEvent
  assert.equal(historyChangeLabel(event, 'ja'), 'モニターを追加 / キーボードを撤去')
  assert.equal(historyChangeLabel({ ...event, inGadgets: [monitor, keyboard], outGadgets: [] }, 'en'), 'Added 2 items')
  assert.equal(historyChangeLabel({ ...event, inGadgets: [], outGadgets: [], modeChanges: [{ gadget: monitor, mode: 'decor' }] }, 'ja'), '使用方法を変更')
  assert.equal(historyChangeLabel({ ...event, isTodayPage: true }, 'ja'), '現在のデスク')
  assert.equal(historyChangeLabel(undefined, 'ja'), '')
})

function dragFrameRuntime(scale: number) {
  const text = readFileSync('src/components/organisms/ConnectionMap.tsx', 'utf8')
  const source = ts.createSourceFile('ConnectionMap.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'ConnectionMapInner')!
  const statements = component.body!.statements
  const update = statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations])
    .find(s => s.name.getText(source) === 'updateDragPosition')!.initializer!.getText(source)
  const call = statements.filter(ts.isExpressionStatement).map(s => s.expression).filter(ts.isCallExpression)
    .find(s => s.expression.getText(source) === 'useFrameCallback')!
  const shared = <T>(value: T) => ({ value })
  const state = {
    dragTracking: shared(true), dragMoved: shared(true), pinching: shared(false),
    dragNode: shared(node), dragPeers: shared([peer]), dragScale: shared(scale),
    dragRawX: shared(110), dragRawY: shared(80), dragStartPan: shared({ x: 0, y: 0 }),
    dragPointer: shared({ x: 294, y: 140 }), dragViewport: shared({ x: 0, y: 0, w: 300, h: 300 }),
    dragBottomInset: shared(80), dragX: shared(0), dragY: shared(0),
    dragDestination: shared({ dx: 0, dy: 0, valid: false, adjusted: false }),
    dragLastValid: shared<{ x: number; y: number } | null>({ x: node.x, y: node.y }),
    dragGuides: shared<{ x: number | null; y: number | null }>({ x: null, y: null }),
    tx: shared(0), ty: shared(0), savedX: shared(0), savedY: shared(0),
  }
  const code = ts.transpileModule(`const updateDragPosition = ${update}; const frame = ${call.arguments[0].getText(source)}; ({ frame, updateDragPosition })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const controls = runInNewContext(code, { ...state, boundedPlacementPan, nearestPlacement, placementEdgeVelocity, placementMoveBounds, resolvePlacementDrag }) as {
    frame: (event: { timeSincePreviousFrame: number }) => void; updateDragPosition: () => void
  }
  return { ...state, ...controls }
}

test('自動移動中のUIフレームは、倍率に関係なく機材を指の下に保ち、長いフレームで飛ばない', () => {
  for (const scale of [0.25, 1, 2]) {
    const drag = dragFrameRuntime(scale)
    drag.updateDragPosition()
    for (let n = 0; n < 10; n++) {
      const previousPan = drag.tx.value
      drag.frame({ timeSincePreviousFrame: n === 4 ? 3000 : 16 })
      assert.ok(Math.abs(drag.tx.value - previousPan) <= 260 * 0.032)
      const pointerX = drag.tx.value + (node.x + drag.dragX.value) * scale
      assert.ok(Math.abs(pointerX - (node.x + drag.dragRawX.value) * scale) <= 6)
      assert.equal(drag.savedX.value, drag.tx.value)
    }
    const stoppedAt = drag.tx.value
    drag.dragTracking.value = false
    drag.frame({ timeSincePreviousFrame: 16 })
    assert.equal(drag.tx.value, stoppedAt)
  }
})

test('長押しだけ・ピンチ中は自動移動せず、連続して端へ運んでもカメラが制限を越えない', () => {
  const drag = dragFrameRuntime(1)
  drag.dragMoved.value = false
  drag.frame({ timeSincePreviousFrame: 16 })
  assert.equal(drag.tx.value, 0)
  drag.dragMoved.value = true
  drag.pinching.value = true
  drag.frame({ timeSincePreviousFrame: 16 })
  assert.equal(drag.tx.value, 0)
  drag.pinching.value = false
  for (let n = 0; n < 1000; n++) drag.frame({ timeSincePreviousFrame: 16 })
  const stoppedAt = drag.tx.value
  assert.equal(node.x + drag.dragX.value, peer.x + peer.w + 600)
  drag.frame({ timeSincePreviousFrame: 16 })
  assert.equal(drag.tx.value, stoppedAt)
})

test('空き位置が近くにない場合は直前の有効位置を枠に示し、既存の重なりからは空き位置を得るまで確定しない', () => {
  const drag = dragFrameRuntime(1)
  drag.dragPeers.value = [{ id: 'cover', x: 400, y: 28, w: 320, h: 320 }]
  drag.dragRawX.value = 450; drag.dragRawY.value = 50
  drag.updateDragPosition()
  assert.equal(drag.dragX.value, 450)
  assert.equal(drag.dragDestination.value.valid, true)
  assert.equal(drag.dragDestination.value.adjusted, true)
  assert.equal(drag.dragDestination.value.dx, 0)
  assert.equal(drag.dragDestination.value.dy, 0)
  drag.dragLastValid.value = null
  drag.updateDragPosition()
  assert.equal(drag.dragDestination.value.valid, false)
})

test('自動移動したあとの配置確定は、プレビューと同じ座標を保存し、倍率で二重に割らない', () => {
  const text = readFileSync('src/components/organisms/ConnectionMap.tsx', 'utf8')
  const source = ts.createSourceFile('ConnectionMap.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const helpers = source.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) &&
    ['moveNodeInLayout', 'offsetAfterMove', 'clampNodeMove'].includes(s.name?.text ?? '')).map(s => s.getText(source)).join('\n')
  let endHandler = ''
  const visit = (s: ts.Node) => {
    if (ts.isVariableDeclaration(s) && s.name.getText(source) === 'dragEndJS') endHandler = s.initializer!.getText(source)
    ts.forEachChild(s, visit)
  }
  visit(source)
  assert.ok(endHandler)
  for (const scale of [0.25, 1, 2]) {
    const drag = dragFrameRuntime(scale)
    for (let i = 0; i < 8; i++) drag.frame({ timeSincePreviousFrame: 16 })
    const nodes = [node, peer].map(n => ({ ...n, cx: n.x + n.w / 2, cy: n.y + n.h / 2 }))
    const layout = { nodes, width: 400, height: 400, bounds: { minX: 100, minY: 100, maxX: 310, maxY: 300 } }
    const latestRef = { current: { layout, nodeOffsets: {}, placementMode: true, nodesById: new Map(nodes.map(n => [n.id, n])) } }
    const placementDeltaRef = { current: {} as Record<string, { dx: number; dy: number }> }
    const code = ts.transpileModule(`${helpers}\n(${endHandler})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    const commit = runInNewContext(code, {
      ...drag, nodeId: node.id, dragToken: `drag:${node.id}`, dragIgnored: false,
      activeNodeGesture: { current: `drag:${node.id}` }, latestRef, placementDeltaRef,
      NODE_MOVE_REACH: 600, FIT_PADDING: 8, hapticLight: () => {},
      setLayout: (next: typeof layout) => { latestRef.current.layout = next }, setDraggingNode: () => {},
    }) as (dx: number, dy: number, success: boolean) => void
    commit(drag.dragDestination.value.dx, drag.dragDestination.value.dy, true)
    const moved = latestRef.current.layout.nodes[0]
    assert.equal(moved.x, node.x + drag.dragDestination.value.dx)
    assert.equal(moved.y, node.y + drag.dragDestination.value.dy)
    assert.equal(placementDeltaRef.current[node.id].dx, drag.dragDestination.value.dx)
    assert.equal(placementDeltaRef.current[node.id].dy, drag.dragDestination.value.dy)
  }
})
