import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { DeskPlan, MapConnection, NodeOffset } from '../src/types'
import { applyMapLayoutChange, captureMapLayoutChange, layoutRestorePan } from '../src/utils/mapLayoutUndo'

const day = '2026-10-16'
const at = (dx: number, dy = 0): NodeOffset => ({ dx, dy, bx: 32, by: 64 })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const wire = (id: string): MapConnection => ({ id, fromGadgetId: 'a', toGadgetId: 'b', cableType: 'USB_C', origin: 'manual', confirmed: true })
function plan(offsets?: Record<string, NodeOffset>): DeskPlan {
  return {
    id: 'desk', name: 'Desk', goal: 'clean_wiring', createdAt: 'before', selectedGadgetIds: ['a', 'b'], placements: [], updatedAt: 'before',
    connectionMap: { connections: [wire('wire')], nodeOffsets: offsets, nodeSizes: { a: { w: 100, h: 80 } } },
  }
}

test('移動のUndoは配線・除外した接続・サイズ・別ノードの位置を維持し、履歴を現在位置に揃える', () => {
  const original = plan({ a: at(0), b: at(0) })
  const change = captureMapLayoutChange(original.connectionMap!, { a: at(10), b: at(0) }, ['a'])
  const moved = applyMapLayoutChange(original, change, day)
  const other = {
    ...moved, connectionMap: {
      ...moved.connectionMap!, connections: [wire('new-wire')], dismissedPairs: ['dismissed'],
      nodeOffsets: { ...moved.connectionMap!.nodeOffsets, b: at(50) }, nodeSizes: { a: { w: 200, h: 160 } },
    },
  }
  const restored = applyMapLayoutChange(other, change, day, true).connectionMap!
  assert.deepEqual(restored.nodeOffsets, { a: at(0), b: at(50) })
  assert.equal(restored.connections, other.connectionMap!.connections)
  assert.equal(restored.dismissedPairs, other.connectionMap!.dismissedPairs)
  assert.equal(restored.nodeSizes, other.connectionMap!.nodeSizes)
  assert.deepEqual(restored.layoutSnapshots![day], { nodeOffsets: restored.nodeOffsets, nodeSizes: restored.nodeSizes })
  assert.deepEqual(original.connectionMap!.nodeOffsets, { a: at(0), b: at(0) })
})

test('初回移動を取り消すと位置指定を外し、既存の基準座標と旧形式も正確に戻す', () => {
  for (const before of [undefined, at(3, 4), { dx: 3, dy: 4 }]) {
    const original = plan(before ? { a: before } : undefined)
    const change = captureMapLayoutChange(original.connectionMap!, { a: at(10) }, ['a'])
    const restored = applyMapLayoutChange(applyMapLayoutChange(original, change, day), change, day, true)
    assert.deepEqual(restored.connectionMap!.nodeOffsets, original.connectionMap!.nodeOffsets)
  }
})

test('リサイズのUndoは左右ペアだけを戻し、他の機材の位置とサイズを維持する', () => {
  const original = plan({ a: at(0) })
  const change = captureMapLayoutChange(original.connectionMap!, {}, [], { a: { w: 200, h: 160 }, right: { w: 200, h: 160 } }, ['a', 'right'])
  const resized = applyMapLayoutChange(original, change, day)
  resized.connectionMap!.nodeOffsets = { a: at(40) }
  resized.connectionMap!.nodeSizes!.b = { w: 300, h: 200 }
  const restored = applyMapLayoutChange(resized, change, day, true)
  assert.deepEqual(restored.connectionMap!.nodeSizes, { a: { w: 100, h: 80 }, b: { w: 300, h: 200 } })
  assert.deepEqual(restored.connectionMap!.nodeOffsets, { a: at(40) })
})

test('同じ機材が後から編集された場合は古いUndoを適用せず、保存失敗後の再試行は同じ結果になる', () => {
  const original = plan({ a: at(0) })
  const change = captureMapLayoutChange(original.connectionMap!, { a: at(10) }, ['a'])
  const moved = applyMapLayoutChange(original, change, day)
  const restored = applyMapLayoutChange(moved, change, day, true)
  assert.deepEqual(applyMapLayoutChange(restored, change, day, true), restored)
  moved.connectionMap!.nodeOffsets = { a: at(20) }
  assert.equal(applyMapLayoutChange(moved, change, day, true), moved)
})

function callback(name: string, bindings: Record<string, unknown>) {
  const file = 'src/screens/WiringResultScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, name)
  return runInNewContext(ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { useCallback: (fn: unknown) => fn, ...bindings }) as (...args: any[]) => any
}

function harness() {
  let current = plan({ a: at(0), b: at(0) })
  let queue: Promise<unknown> = Promise.resolve()
  let fail = false
  let waitForDrawing = false
  let drawing: { onComplete: () => void; onError: (error: unknown) => void } | null = null
  const actions: { message: string; onUndo: () => Promise<void> }[] = []
  const alerts: string[] = []
  const edit = { gesture: false, saving: 0, restoring: false, revision: 0 }
  const state = { blocked: false }
  const mounted = { current: true }
  const bindings = {
    planId: 'desk', lang: 'ja', gadgets: [{ id: 'a', name: 'Monitor' }],
    layoutEditRef: { current: edit }, pendingLayoutRestoreRef: { current: null }, layoutScreenMountedRef: mounted,
    localDateKey: () => day, captureMapLayoutChange, applyMapLayoutChange,
    baseMapNodeId: (id: string) => id, gadgetTitle: (g: { name: string }) => g.name,
    updateWith: (_id: string, mutate: (p: DeskPlan) => DeskPlan, options: { awaitPersistence?: boolean }) => {
      assert.equal(options.awaitPersistence, true)
      const result = queue.then(() => {
        const previous = structuredClone(current)
        current = mutate(current)
        if (fail) { fail = false; current = previous; throw new Error('storage failed') }
        return current
      })
      queue = result.catch(() => {})
      return result
    },
    undoSnackbar: { setBlocked: (value: boolean) => { state.blocked = value }, showUndo: (action: any) => actions.push(action) },
    analytics: { error() {} }, Alert: { alert: (message: string) => alerts.push(message) },
    withTimeout: (value: Promise<unknown>) => value, QUICK_TIMEOUT_MS: 20000,
    setLayoutRestoreRequest: (request: typeof drawing) => { drawing = request; if (!waitForDrawing) request?.onComplete() },
  }
  const save = callback('saveNodeLayout', bindings) as (offsets: Record<string, NodeOffset>, ids: string[], sizes?: Record<string, { w: number; h: number }>, skipUndo?: boolean, offsetIds?: string[]) => Promise<void>
  return {
    save, actions, alerts, state, edit, mounted, current: () => current,
    start: callback('handleLayoutEditStart', bindings) as () => boolean,
    end: callback('handleLayoutEditEnd', bindings) as () => void,
    fail: () => { fail = true }, waitForDrawing: () => { waitForDrawing = true }, drawing: () => drawing,
  }
}

test('再描画前に同じガジェットを2回移動しても、Undoで直前の保存位置へ戻る', async () => {
  const h = harness()
  const first = h.save({ a: at(10), b: at(0) }, ['a'])
  const second = h.save({ a: at(20), b: at(0) }, ['a'])
  await Promise.all([first, second])
  assert.equal(h.actions.length, 1)
  assert.match(h.actions[0].message, /Monitor/)
  await h.actions[0].onUndo()
  assert.deepEqual(h.current().connectionMap!.nodeOffsets!.a, at(10))
})

test('リサイズに伴う表示位置の固定はサイズと一度に保存し、Undoで固定前へ戻す', async () => {
  const h = harness()
  const original = structuredClone(h.current().connectionMap!)
  await h.save({ a: at(0), b: at(15), extra: at(20) }, ['a'], { a: { w: 160, h: 120 } }, false, ['a', 'b', 'extra'])
  assert.deepEqual(h.current().connectionMap!.nodeOffsets, { a: at(0), b: at(15), extra: at(20) })
  assert.equal(h.current().connectionMap!.nodeSizes!.a.w, 160)
  await h.actions[0].onUndo()
  assert.deepEqual(h.current().connectionMap!.nodeOffsets, original.nodeOffsets)
  assert.deepEqual(h.current().connectionMap!.nodeSizes, original.nodeSizes)
})

test('古い全ノード配列を渡してもBの移動はAの移動を消さず、UndoでBだけ戻る', async () => {
  const h = harness()
  await h.save({ a: at(10), b: at(0) }, ['a'])
  await h.save({ a: at(0), b: at(20) }, ['b'])
  assert.deepEqual(h.current().connectionMap!.nodeOffsets, { a: at(10), b: at(20) })
  await h.actions[1].onUndo()
  assert.deepEqual(h.current().connectionMap!.nodeOffsets, { a: at(10), b: at(0) })
})

test('保存失敗では成功通知を出さずUndoの抑止を解除する', async () => {
  const h = harness()
  h.fail()
  await h.save({ a: at(10) }, ['a'])
  assert.equal(h.actions.length, 0)
  assert.equal(h.alerts.length, 1)
  assert.equal(h.state.blocked, false)
  assert.deepEqual(h.current().connectionMap!.nodeOffsets!.a, at(0))
})

test('Undoの保存失敗後に別の移動をしたら、古い再試行で上書きしない', async () => {
  const h = harness()
  await h.save({ a: at(10) }, ['a'])
  const old = h.actions[0]
  h.fail()
  await assert.rejects(old.onUndo(), /storage failed/)
  assert.equal(h.edit.restoring, false)
  await h.save({ a: at(30) }, ['a'])
  await old.onUndo()
  assert.deepEqual(h.current().connectionMap!.nodeOffsets!.a, at(30))
})

test('ドラッグ開始から保存完了までUndoを抑止し、復元描画が終わるまで新しい編集を受けない', async () => {
  const h = harness()
  assert.equal(h.start(), true)
  assert.equal(h.start(), false)
  const save = h.save({ a: at(10) }, ['a'])
  h.end()
  assert.equal(h.state.blocked, true)
  assert.equal(h.start(), false)
  await save
  assert.equal(h.state.blocked, false)
  h.waitForDrawing()
  let complete = false
  const undo = h.actions[0].onUndo().then(() => { complete = true })
  await flush()
  assert.equal(complete, false)
  assert.equal(h.start(), false)
  h.drawing()!.onComplete()
  await undo
  assert.equal(h.start(), true)
  h.end()
})

test('復元描画が失敗しても編集ロックを解除して再試行できる', async () => {
  const h = harness()
  await h.save({ a: at(10) }, ['a'])
  h.waitForDrawing()
  const undo = h.actions[0].onUndo()
  const rejected = assert.rejects(undo, /drawing failed/)
  await flush()
  h.drawing()!.onError(new Error('drawing failed'))
  await rejected
  assert.equal(h.edit.restoring, false)
  assert.equal(h.start(), true)
  h.end()
})

test('配置モードの確定では位置を保存して取り消し通知は出さない', async () => {
  const h = harness()
  await h.save({ a: at(50) }, ['a'], undefined, true)
  assert.deepEqual(h.current().connectionMap!.nodeOffsets!.a, at(50))
  assert.equal(h.actions.length, 0)
})

test('保存待ちで画面を閉じたらUndo通知や描画待ちを新たに開始しない', async () => {
  const h = harness()
  const saving = h.save({ a: at(10) }, ['a'])
  h.mounted.current = false
  await saving
  assert.equal(h.actions.length, 0)
  h.mounted.current = true
  await h.save({ a: at(20) }, ['a'])
  h.waitForDrawing()
  const undo = h.actions[0].onUndo()
  h.mounted.current = false
  await undo
  assert.equal(h.drawing(), null)
  assert.equal(h.edit.restoring, false)
})

test('Undo後の画面位置は倍率を変えず、対象が見える場合は維持し、画面外の場合だけ最小限に動かす', () => {
  const bounds = { minX: 100, maxX: 200, minY: 100, maxY: 200 }
  assert.deepEqual(layoutRestorePan(bounds, { w: 500, h: 500 }, 2, 0, 0), { x: 0, y: 0 })
  assert.deepEqual(layoutRestorePan(bounds, { w: 500, h: 500 }, 2, -300, 0), { x: -180, y: 0 })
  assert.deepEqual(layoutRestorePan(bounds, { w: 500, h: 300 }, 2, 0, 0), { x: 0, y: -120 })
})

function mapEffect(hint: string, bindings: Record<string, unknown>) {
  const file = 'src/components/organisms/ConnectionMap.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(source))
      && node.arguments[0]?.getText(source).includes(hint)) expression = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, hint)
  const run = runInNewContext(ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bindings)
  return run()
}

test('表示済みの図は完全に同じ入力にだけ再利用し、配線が変わった場合は別の図を取得する', () => {
  const oldLayout = { nodes: [{ id: 'a' }], edges: [{ id: 'old-route' }] }
  const newLayout = { nodes: [{ id: 'a' }], edges: [{ id: 'new-route' }] }
  for (const same of [true, false]) {
    let displayed: unknown
    let lookedUp = 0
    mapEffect('const localCommit = localLayoutCommitRef.current', {
      AbortController, localLayoutCommitRef: { current: null }, layoutInputKey: same ? 'before' : 'different-wires',
      displayedLayoutsRef: { current: new Map([['before', oldLayout]]) }, placementDeltaRef: { current: null },
      layoutInput: { gadgets: [], connections: [] }, plan: { id: 'desk', placements: [] }, nodeOffsets: {}, nodeSizes: {},
      tryGetCachedLayout: () => { lookedUp++; return newLayout },
      revealLayout: (layout: unknown) => { displayed = layout },
    })
    assert.equal(displayed, same ? oldLayout : newLayout)
    assert.equal(lookedUp, same ? 0 : 1)
  }
})

test('Undoの完了は復元対象の図が描画されるまで通知せず、描画後は倍率を変えない', () => {
  let completed = 0
  const tx = { value: -300 }, ty = { value: 0 }, scale = { value: 2 }
  const bindings = {
    layoutRestoreRequest: { nodeIds: ['a'], onComplete: () => { completed++ } },
    layout: { nodes: [{ id: 'a', x: 100, y: 100, w: 100, h: 100 }] },
    layoutInputKey: 'restored', displayedInputKeyRef: { current: 'moved' },
    active: true, vp: { w: 500, h: 500 }, fitBottomInsetRef: { current: 0 },
    layoutRestorePan, scale, tx, ty, savedX: { value: -300 }, savedY: { value: 0 }, pinchNeedsRebase: { value: false },
  }
  mapEffect('layoutRestoreRequest.nodeIds.includes', bindings)
  assert.equal(completed, 0)
  bindings.displayedInputKeyRef.current = 'restored'
  mapEffect('layoutRestoreRequest.nodeIds.includes', bindings)
  assert.equal(completed, 1)
  assert.equal(scale.value, 2)
  assert.equal(tx.value, -180)
  assert.equal(bindings.savedX.value, tx.value)
  assert.equal(bindings.pinchNeedsRebase.value, true)
})
