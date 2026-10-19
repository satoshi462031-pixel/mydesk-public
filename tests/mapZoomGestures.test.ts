import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { dragEdgePoints, pointsToPath, pointsToRoundedPath, wavyPath } from '../src/utils/connectionMapLayout'
import { nearestPlacement, resolvePlacementDrag, resolvePlacementResize } from '../src/utils/placementGesture'

const source = ts.createSourceFile('ConnectionMap.tsx', readFileSync('src/components/organisms/ConnectionMap.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function evaluate(name: string, bindings: Record<string, any>, factory = false): any {
  let value: ts.Expression | undefined
  function visit(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && n.name.getText(source) === name) value = n.initializer
    ts.forEachChild(n, visit)
  }
  visit(source)
  assert.ok(value, name)
  const expression = factory && ts.isCallExpression(value) ? value.arguments[0] : value
  return runInNewContext(ts.transpileModule(`(${expression.getText(source)})${factory ? '()' : ''}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bindings)
}

function fixture() {
  const gestures: Record<string, any>[] = []
  const bindings: Record<string, any> = { MAX_CANVAS_SCALE: 2.5, FIT_PADDING: 20 }
  for (const name of ['scale', 'savedS', 'pinchStartS', 'pinchBaseScale']) bindings[name] = { value: 1 }
  for (const name of ['tx', 'ty', 'savedX', 'savedY', 'pinchStartX', 'pinchStartY', 'pinchStartFx', 'pinchStartFy']) bindings[name] = { value: 0 }
  for (const name of ['pinching', 'pinchNeedsRebase', 'userAdjusted', 'editingGesture']) bindings[name] = { value: false }
  Object.assign(bindings, {
    minScale: { value: 0.1 }, vp: { w: 400, h: 600 }, fitBottomInsetRef: { current: 0 }, plan: {}, visibleEdges: [],
    layout: { width: 500, height: 400, bounds: { minX: 20, minY: 30, maxX: 480, maxY: 370 }, nodes: [] },
    Gesture: { Pan: () => makeGesture(), Pinch: () => makeGesture() },
  })
  function makeGesture() {
    const callbacks: Record<string, any> = {}
    const chain = new Proxy({}, { get: (_obj, key: string) => (...args: any[]) => { callbacks[key] = args[0]; return chain } })
    gestures.push(callbacks)
    return chain
  }
  evaluate('panG', bindings, true)
  evaluate('pinchG', bindings, true)
  const screen = (x: number, y: number, width: number, height: number) => {
    const style = evaluate('canvasStyle', bindings, true)
    const ox = style.transformOrigin?.[0] ?? width / 2, oy = style.transformOrigin?.[1] ?? height / 2
    return { x: ox + bindings.tx.value + bindings.scale.value * (x-ox), y: oy + bindings.ty.value + bindings.scale.value * (y-oy) }
  }
  return { bindings, gestures, screen, evaluate: (name: string) => evaluate(name, bindings) }
}

test('拡大後にキャンバスの寸法が変わっても同じ座標の画面位置を維持する', () => {
  const h = fixture()
  h.bindings.scale.value = 0.5; h.bindings.tx.value = 20; h.bindings.ty.value = -10
  assert.deepEqual(h.screen(300, 240, 500, 400), h.screen(300, 240, 1000, 800))
})

test('全体表示で内容を中央に収め、ピンチで指の下の点を保つ', () => {
  const h = fixture(), b = h.bindings, pinch = h.gestures[1]
  h.evaluate('fit')()
  assert.deepEqual(h.screen(250, 200, 500, 400), { x: 200, y: 300 })
  const startScale = b.scale.value, point = { x: (150-b.tx.value)/startScale, y: (180-b.ty.value)/startScale }
  pinch.onStart()
  pinch.onUpdate({ numberOfPointers: 2, scale: 1, focalX: 150, focalY: 180 })
  pinch.onUpdate({ numberOfPointers: 2, scale: 1.8, focalX: 170, focalY: 200 })
  assert.ok(Math.abs(h.screen(point.x, point.y, 500, 400).x - 170) < 1e-9)
  assert.ok(Math.abs(h.screen(point.x, point.y, 500, 400).y - 200) < 1e-9)
})

test('全体表示は下端の操作行を避け、その上の範囲の中央に収める', () => {
  const h = fixture()
  h.bindings.fitBottomInsetRef.current = 80
  h.evaluate('fit')()
  assert.deepEqual(h.screen(250, 200, 500, 400), { x: 200, y: 260 })
})

test('ピンチの指が1本になって戻っても飛ばず、パンが過去の移動量を重ねない', () => {
  const h = fixture(), b = h.bindings, [pan, pinch] = h.gestures
  pan.onChange({ changeX: 30, changeY: 40 })
  pinch.onStart()
  pinch.onUpdate({ numberOfPointers: 2, scale: 1, focalX: 100, focalY: 100 })
  pinch.onUpdate({ numberOfPointers: 2, scale: 2, focalX: 110, focalY: 110 })
  const position = [b.savedS.value, b.savedX.value, b.savedY.value]
  pan.onChange({ changeX: 70, changeY: 80 })
  assert.deepEqual([b.savedS.value, b.savedX.value, b.savedY.value], position)
  pinch.onUpdate({ numberOfPointers: 1, scale: 2.5, focalX: 500, focalY: 500 })
  assert.deepEqual([b.savedS.value, b.savedX.value, b.savedY.value], position)
  pinch.onUpdate({ numberOfPointers: 2, scale: 3, focalX: 130, focalY: 130 })
  assert.deepEqual([b.savedS.value, b.savedX.value, b.savedY.value], position)
  pinch.onFinalize()
  pan.onChange({ changeX: 10, changeY: 20 })
  assert.equal(b.savedX.value, position[1]+10); assert.equal(b.savedY.value, position[2]+20)
})

test('ガジェット編集の途中はカメラのピンチとパンを反映しない', () => {
  const h = fixture(), b = h.bindings, [pan, pinch] = h.gestures
  b.editingGesture.value = true
  pinch.onStart()
  pinch.onUpdate({ numberOfPointers: 2, scale: 1, focalX: 100, focalY: 100 })
  pinch.onUpdate({ numberOfPointers: 2, scale: 2, focalX: 150, focalY: 150 })
  assert.equal(b.scale.value, 1)
  pinch.onFinalize()
  pan.onStart?.()
  if (pan.onChange) pan.onChange({ changeX: 100, changeY: 100 })
  else pan.onUpdate({ translationX: 100, translationY: 100 })
  assert.equal(b.tx.value, 0); assert.equal(b.ty.value, 0)
})

function nodeFixture() {
  const h = fixture(), b = h.bindings
  const state = { resize: null as any, dragging: null as string | null, xy: { x: 0, y: 0 } }
  const node = { id: 'monitor', x: 32, y: 64, w: 200, h: 100, gadget: { category: 'Monitor' } }
  const writes: any[] = []
  Object.assign(b, {
    nodeCommitBusyUntil: { current: 0 }, nodeCommitTimerRef: { current: null }, activeNodeGesture: { current: null }, nodeGestureCache: new Map(),
    resizeStart: { w0: 200, h0: 100, scale0: 1 }, NODE_W: 200, NODE_H: 100, NODE_MIN: 68, NODE_COMMIT_BUSY_MS: 10, REWIRE_DELAY: 10, REWIRE_SETTLE: 10,
    clampSize: (n: number) => Math.round(Math.max(40, Math.min(320, n))),
    latestRef: { current: { nodesById: new Map([['monitor', node]]), placementMode: false, nodeSizes: {}, nodeOffsets: {}, onNodeSizesChange: (sizes: any) => writes.push(sizes) } },
    pairedSplitKeyboardNodeId: () => undefined, pinchG: {}, panG: {}, hapticMedium() {}, dismissMoveHint() {},
    setResizePrev: (value: any) => { state.resize = typeof value === 'function' ? value(state.resize) : value },
    setDraggingNode: (value: any) => { state.dragging = typeof value === 'function' ? value(state.dragging) : value },
    dragX: { value: 0 }, dragY: { value: 0 }, dragOwner: { value: '' }, dragScale: { value: 1 }, dragHold: { value: false },
    dragTracking: { value: false }, dragMoved: { value: false }, dragRawX: { value: 0 }, dragRawY: { value: 0 },
    dragStartPan: { value: { x: 0, y: 0 } }, dragPointer: { value: { x: 0, y: 0 } },
    dragViewport: { value: { x: 0, y: 0, w: 400, h: 600 } },
    dragNode: { value: null }, dragNodes: { value: [node] }, dragPeers: { value: [] }, dragGuides: { value: { x: null, y: null } },
    dragDestination: { value: { dx: 0, dy: 0, valid: true, adjusted: false } }, dragLastValid: { value: null },
    placementDeltaRef: { current: null }, setAwaitingWiring() {}, setRelayouting() {}, setLayout() {},
    measure: () => ({ pageX: 0, pageY: 0, width: 400, height: 600 }), viewportRef: {}, resolvePlacementDrag, nearestPlacement, resolvePlacementResize,
    NODE_MOVE_REACH: 600, hapticLight() {},
    runOnJS: (fn: (...args: any[]) => void) => fn, setTimeout: (fn: () => void) => fn(),
  })
  for (const name of ['offsetAfterMove', 'moveNodeInLayout', 'clampNodeMove']) {
    const declaration = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name)!
    b[name] = runInNewContext(ts.transpileModule(`(${declaration.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, b)
  }
  b.updateDragPosition = evaluate('updateDragPosition', b)
  const gestures = evaluate('getNodeGestures', b)
  const controls = gestures('monitor')
  return { ...h, state, writes, moveTo: controls.moveTo, drag: h.gestures[2], resize: h.gestures[3], addNode: (id: string) => { gestures(id); return h.gestures[h.gestures.length - 2] } }
}

test('ガジェットのリサイズも中断なら保存せず、倍率が変わっても開始時の倍率で移動量を測る', () => {
  const h = nodeFixture()
  h.bindings.savedS.value = 2
  h.resize.onStart()
  h.resize.onUpdate({ translationX: 80, translationY: 40 })
  assert.equal(h.state.resize.w, 240)
  h.bindings.savedS.value = 1
  h.resize.onUpdate({ translationX: 80, translationY: 40 })
  assert.equal(h.state.resize.w, 240)
  h.resize.onEnd({ translationX: 80, translationY: 40 }, false)
  h.resize.onFinalize({}, false)
  assert.equal(h.writes.length, 0)
  assert.equal(h.state.resize, null)
  assert.equal(h.bindings.activeNodeGesture.current, null)
})

test('ガジェット移動を中断するとプレビューと編集ロックをすぐに戻す', () => {
  const h = nodeFixture()
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onUpdate({ translationX: 80, translationY: 40 })
  h.drag.onEnd({ translationX: 80, translationY: 40 }, false)
  h.drag.onFinalize({}, false)
  assert.equal(h.state.dragging, null)
  assert.equal(h.bindings.dragX.value, 0)
  assert.equal(h.bindings.dragY.value, 0)
  assert.equal(h.bindings.dragOwner.value, '')
  assert.equal(h.bindings.activeNodeGesture.current, null)
  assert.equal(h.bindings.editingGesture.value, false)
})

test('倍率の上下限でも焦点を維持し、無効な倍率を受け流す', () => {
  const h = fixture(), b = h.bindings, pinch = h.gestures[1]
  pinch.onStart()
  pinch.onUpdate({ numberOfPointers: 2, scale: 1, focalX: 100, focalY: 120 })
  for (const [input, expected] of [[100, 2.5], [0.001, 0.1]]) {
    pinch.onUpdate({ numberOfPointers: 2, scale: input, focalX: 100, focalY: 120 })
    assert.equal(b.savedS.value, expected)
    assert.deepEqual(h.screen(100, 120, 500, 400), { x: 100, y: 120 })
  }
  const position = [b.savedS.value, b.savedX.value, b.savedY.value]
  pinch.onUpdate({ numberOfPointers: 2, scale: 0, focalX: 300, focalY: 300 })
  assert.deepEqual([b.savedS.value, b.savedX.value, b.savedY.value], position)
})

test('拡大中のリサイズを完了するとプレビューと同じ寸法を一度保存する', () => {
  const h = nodeFixture()
  h.bindings.savedS.value = 2
  h.resize.onStart()
  h.resize.onUpdate({ translationX: 80, translationY: 40 })
  h.bindings.savedS.value = 1
  h.resize.onEnd({ translationX: 80, translationY: 40 }, true)
  h.resize.onFinalize({}, true)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].monitor.w, 240)
  assert.equal(h.writes[0].monitor.h, 120)
  assert.equal(h.state.resize, null)
  assert.equal(h.bindings.editingGesture.value, false)
})

test('機材の移動は拡大中も指と同じだけ動き、掴んでいる間は別の機材が移動量を書き換えない', () => {
  const h = nodeFixture(), b = h.bindings
  b.savedS.value = 2
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onUpdate({ translationX: 80, translationY: 40 })
  // 図は2倍で描かれているので、content 座標の 40 が画面の 80（指の移動量）になる
  assert.deepEqual([b.dragX.value, b.dragY.value], [40, 20])
  assert.equal(h.state.dragging, 'monitor')
  const other = h.addNode('speaker')
  other.onStart({ absoluteX: 132, absoluteY: 114 })
  other.onUpdate({ translationX: -200, translationY: -200 })
  assert.deepEqual([b.dragX.value, b.dragY.value], [40, 20])
  assert.equal(b.dragOwner.value, 'monitor')
})

test('配線の再計算が完了するまでは次の移動とリサイズを保存しない', () => {
  const h = nodeFixture(), b = h.bindings
  b.latestRef.current.relayouting = true
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onUpdate({ translationX: 80, translationY: 40 })
  h.drag.onEnd({ translationX: 80, translationY: 40 }, true)
  h.drag.onFinalize({}, true)
  assert.equal(h.state.dragging, null)
  assert.deepEqual([b.dragX.value, b.dragY.value], [0, 0])
  h.resize.onStart()
  h.resize.onUpdate({ translationX: 80, translationY: 40 })
  h.resize.onEnd({ translationX: 80, translationY: 40 }, true)
  h.resize.onFinalize({}, true)
  assert.equal(h.state.resize, null)
  assert.equal(h.writes.length, 0)

  b.latestRef.current.relayouting = false
  h.resize.onStart()
  h.resize.onUpdate({ translationX: 80, translationY: 40 })
  h.resize.onEnd({ translationX: 80, translationY: 40 }, true)
  h.resize.onFinalize({}, true)
  assert.equal(h.writes.length, 1)
})

test('仮配線を作れない移動も確定位置を表示し、配線の計算を待つ', () => {
  const h = nodeFixture(), b = h.bindings
  const originalLayout = { nodes: [...b.latestRef.current.nodesById.values()], edges: [] }
  b.latestRef.current.layout = originalLayout
  b.latestRef.current.onNodeOffsetsChange = (offsets: any) => h.writes.push(offsets)
  Object.assign(b, {
    clampNodeMove: (_layout: unknown, _id: string, moveX: number, moveY: number) => ({ moveX, moveY }),
    offsetAfterMove: (_prev: unknown, _node: unknown, dx: number, dy: number) => ({ dx, dy }),
    patchLayoutNodeMove: () => null,
    hapticLight() {},
    setRelayouting: (value: boolean) => { b.latestRef.current.relayouting = value },
    setLayout: (next: any) => { b.latestRef.current.layout = next },
    localLayoutCommitRef: { current: null },
  })
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onUpdate({ translationX: 80, translationY: 40 })
  h.drag.onEnd({ translationX: 80, translationY: 40 }, true)
  h.drag.onFinalize({}, true)
  assert.equal(h.state.dragging, null)
  assert.equal(b.latestRef.current.layout.nodes[0].x, originalLayout.nodes[0].x + 80)
  assert.equal(b.latestRef.current.relayouting, true)
  assert.equal(h.writes.length, 1)
  assert.deepEqual({ ...h.writes[0].monitor }, { dx: 80, dy: 40 })
})

test('Undoの復元中はドラッグもリサイズも開始せず、解除後の中断と長押しだけでも編集状態を解除する', () => {
  const h = nodeFixture(), b = h.bindings
  let allow = false
  let ended = 0
  b.latestRef.current.onLayoutEditStart = () => allow
  b.latestRef.current.onLayoutEditEnd = () => { ended++ }
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onFinalize({}, false)
  h.resize.onStart()
  h.resize.onFinalize({}, false)
  assert.equal(h.state.dragging, null)
  assert.equal(h.state.resize, null)
  assert.equal(ended, 0)
  allow = true
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onFinalize({}, false)
  assert.equal(ended, 1)
  b.clampNodeMove = () => ({ moveX: 0, moveY: 0 })
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onEnd({ translationX: 0, translationY: 0 }, true)
  h.drag.onFinalize({}, true)
  assert.equal(ended, 2)
  assert.equal(h.writes.length, 0)
})

test('ドラッグを離した時点で一度保存し、確定後にUndoの抑止を解除する', () => {
  const h = nodeFixture(), b = h.bindings
  const timers: (() => void)[] = []
  let ended = 0
  let ids: string[] = []
  Object.assign(b, {
    setTimeout: (run: () => void) => { timers.push(run); return timers.length },
    clampNodeMove: (_layout: unknown, _id: string, moveX: number, moveY: number) => ({ moveX, moveY }),
    offsetAfterMove: (_prev: unknown, _node: unknown, dx: number, dy: number) => ({ dx, dy }),
    hapticLight() {}, setRelayouting() {},
  })
  b.latestRef.current.onLayoutEditStart = () => true
  b.latestRef.current.onLayoutEditEnd = () => { ended++ }
  b.latestRef.current.onNodeOffsetsChange = (offsets: unknown, changed: string[]) => { h.writes.push(offsets); ids = changed }
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onUpdate({ translationX: 80, translationY: 40 })
  h.drag.onEnd({ translationX: 80, translationY: 40 }, true)
  h.drag.onFinalize({}, true)
  assert.equal(timers.length, 0)
  assert.equal(ended, 1)
  assert.equal(h.writes.length, 1)
  assert.deepEqual([...ids], ['monitor'])
})

test('空き位置への移動も通常の保存経路を使い、周囲の表示位置を固定して一度だけ保存する', () => {
  const h = nodeFixture(), b = h.bindings
  const monitor = { ...b.latestRef.current.nodesById.get('monitor'), baseX: 32, baseY: 64 }
  const peer = { id: 'peer', x: 350, y: 100, w: 80, h: 100, baseX: 300, baseY: 100 }
  b.latestRef.current.nodesById = new Map([['monitor', monitor], ['peer', peer]])
  b.latestRef.current.layout = { nodes: [monitor, peer], edges: [], width: 500, height: 400, bounds: { minX: 32, minY: 64, maxX: 430, maxY: 200 } }
  b.patchLayoutNodeMove = () => null
  let changed: string[] = []
  b.latestRef.current.onNodeOffsetsChange = (offsets: any, ids: string[]) => { h.writes.push(offsets); changed = ids }
  h.moveTo(0, 180)
  assert.equal(h.writes.length, 1)
  assert.deepEqual({ ...h.writes[0].monitor }, { dx: 0, dy: 180, bx: 32, by: 64 })
  assert.deepEqual({ ...h.writes[0].peer }, { dx: 50, dy: 0, bx: 300, by: 100 })
  assert.deepEqual([...changed], ['monitor', 'peer'])
  assert.equal(b.activeNodeGesture.current, null)
})

test('配線のanimated propsはカードと同じReact選択・共有移動量を使い、離した後も確定描画まで保持する', () => {
  const declaration = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'DragWirePath')!
  const render = runInNewContext(ts.transpileModule(`(${declaration.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, {
    React: { createElement: (_component: unknown, props: unknown) => props }, AnimatedWirePath: 'path',
    useAnimatedProps: (fn: () => unknown) => fn(), dragEdgePoints, pointsToPath, pointsToRoundedPath, wavyPath,
  })
  const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }]
  for (const cableType of ['USB_C', 'wirelessCharging']) for (const isPairLink of [false, true]) {
    const edge = { from: { id: 'a' }, to: { id: 'b' }, conn: { cableType }, isPairLink, points }
    const draw = isPairLink ? pointsToPath : cableType === 'wirelessCharging' ? wavyPath : pointsToRoundedPath
    for (const scale of [0.5, 2]) {
      const dragX = { value: 40 / scale }, dragY = { value: 20 / scale }
      const props = { edge, d: draw(points), draggingNode: null, dragX, dragY }
      // JSの開始通知が遅れている間は、カードも線も元の位置に留まる。
      assert.equal(render(props).animatedProps.d, draw(points))
      const dragging = { ...props, draggingNode: 'a' }
      const expected = draw(dragEdgePoints(points, true, false, isPairLink, dragX.value, dragY.value))
      assert.equal(render(dragging).animatedProps.d, expected)
      // onFinalizeのUI owner解放に関係なくReactの確定描画まで同じ位置を使う。
      assert.equal(render(dragging).animatedProps.d, expected)
      assert.equal(render({ ...props, d: expected, edge: { ...edge, points: dragEdgePoints(points, true, false, isPairLink, dragX.value, dragY.value) } }).animatedProps.d, expected)
    }
  }
})

test('JS通知が遅れてもUIの移動量を保持し、開始・確定の順で一度だけ保存する', () => {
  const h = nodeFixture(), b = h.bindings
  const queued: (() => void)[] = []
  b.runOnJS = (fn: (...args: any[]) => void) => (...args: any[]) => queued.push(() => fn(...args))
  b.latestRef.current.onNodeOffsetsChange = (offsets: unknown) => h.writes.push(offsets)
  b.latestRef.current.layout = { nodes: [...b.latestRef.current.nodesById.values()], edges: [] }
  b.patchLayoutNodeMove = () => null
  b.setLayout = (next: unknown) => { b.latestRef.current.layout = next }
  b.setRelayouting = () => {}
  h.drag.onStart({ absoluteX: 132, absoluteY: 114 })
  h.drag.onUpdate({ translationX: 80, translationY: 40 })
  h.drag.onEnd({ translationX: 80, translationY: 40 }, true)
  h.drag.onFinalize({}, true)
  assert.equal(h.state.dragging, null)
  assert.equal(h.writes.length, 0)
  assert.equal(b.dragOwner.value, 'monitor')
  const position = [b.dragX.value, b.dragY.value]
  queued.shift()!()
  assert.equal(h.state.dragging, 'monitor')
  assert.deepEqual([b.dragX.value, b.dragY.value], position)
  queued.shift()!()
  assert.equal(h.state.dragging, null)
  assert.equal(h.writes.length, 1)
  queued.shift()!()
  assert.equal(b.dragOwner.value, '')
  assert.equal(h.writes.length, 1)
})
