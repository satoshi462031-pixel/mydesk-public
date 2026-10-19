import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { requiresPhysicalCable } from '../src/constants/portTypes'
import type { MapConnection } from '../src/types'
import { computeMapLayout, type MapEdge } from '../src/utils/connectionMapLayout'

const file = 'src/components/organisms/ConnectionMap.tsx'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function initializer(name: string): ts.Expression {
  let result: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, `Missing ${name}`)
  return result
}

function evaluate(name: string, bindings: Record<string, unknown>, memo = false): any {
  const value = initializer(name)
  const expression = memo && ts.isCallExpression(value) ? value.arguments[0] : value
  const code = ts.transpileModule(`(${expression.getText(source)})${memo ? '()' : ''}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return runInNewContext(code, { requiresPhysicalCable, ...bindings })
}

function connection(extra: Partial<MapConnection> = {}): MapConnection {
  return { id: 'c1', fromGadgetId: 'wall', toGadgetId: 'speaker', cableType: 'Power', origin: 'auto', confirmed: true, ...extra }
}

function edge(conn: MapConnection, extra: Partial<MapEdge> = {}): MapEdge {
  return { conn, ...extra } as MapEdge
}

function visible(edges: MapEdge[], connections: MapConnection[]): MapEdge[] {
  return evaluate('visibleEdges', {
    layout: { edges }, connections,
    isBadgeOnlyEdge: (item: MapEdge) => item.conn.cableType === 'WiFi',
  }, true)
}

function counts(edges: MapEdge[]): Map<string, number> {
  return evaluate('cableTypeCounts', { visibleEdges: edges }, true)
}

test('全体表示で避ける下端の帯は、閲覧時も操作行を、配置バー・移動ヒントがあればその分も含める', () => {
  const state = { active: true, placementMode: false, placementBarH: 100, effectiveEditMode: false, moveHintDone: false }
  assert.equal(evaluate('viewportBottomInset', state), 80)
  assert.equal(evaluate('viewportBottomInset', { ...state, moveHintDone: true }), 80)
  assert.equal(evaluate('viewportBottomInset', { ...state, effectiveEditMode: true }), 120)
  assert.equal(evaluate('viewportBottomInset', { ...state, effectiveEditMode: true, moveHintDone: true }), 80)
  assert.equal(evaluate('viewportBottomInset', { ...state, placementMode: true }), 180)
  assert.equal(evaluate('viewportBottomInset', { ...state, placementMode: true, active: false }), 0)
})

test('HUDの本数は線に表示する×Nと一致し、無線・ペアの線は物理本数に混ぜない', () => {
  const result = counts([
    edge(connection({ count: 3 })),
    edge(connection({ id: 'other', count: 2 })),
    edge(connection({ id: 'bt', cableType: 'Bluetooth', count: 5 })),
    edge(connection({ id: 'pair' }), { isPairLink: true }),
  ])
  assert.equal(result.get('Power'), 5)
  assert.equal(result.get('Bluetooth'), 1)
})

test('撤去・削除した接続は再計算前でもHUDとタップ対象から消える', () => {
  assert.equal(visible([edge(connection())], []).length, 0)
})

test('充電時のみと常時接続の切り替えは、現在の接続からHUDへの表示を判定する', () => {
  assert.equal(visible([edge(connection({ chargingOnly: true }))], [connection({ chargingOnly: false })]).length, 1)
  assert.equal(visible([edge(connection({ chargingOnly: false }))], [connection({ chargingOnly: true })]).length, 0)
})

test('Wi-Fiへ変更した直後に古い種類の線をHUDへ残さない', () => {
  assert.equal(visible([edge(connection())], [connection({ cableType: 'WiFi' })]).length, 0)
})

test('現在の接続にない分割キーボードの関係線は残す', () => {
  assert.equal(visible([edge(connection({ id: 'pair' }), { isPairLink: true })], []).length, 1)
})

test('ウーファー用の電源線を展開しても、本数を二重に数えず、親の削除・充電設定に追従する', async () => {
  const speaker = { id: 'speaker', name: 'Speaker', category: 'Speaker' as const, ports: [], createdAt: '2026-01-01', hasSubwoofer: true }
  const original = connection({ count: 2 })
  const layout = await computeMapLayout([speaker], [original], [])
  for (const count of [2, 3]) {
    const edges = visible(layout.edges, [connection({ count })])
    assert.equal(counts(edges).get('Power'), count)
    assert.equal(edges.find(item => item.conn.id === original.id)?.conn.count ?? 1, count - 1)
  }
  assert.equal(visible(layout.edges, []).filter(item => !item.isPairLink).length, 0)
  assert.equal(visible(layout.edges, [connection({ chargingOnly: true })]).filter(item => !item.isPairLink).length, 0)
})

test('線の編集ではウーファー分岐前の本数を使い、削除済みの線は開かない', () => {
  const original = connection({ count: 2 })
  let opened: MapConnection | null = null
  const removingConnections = { current: new Set<string>() }
  const open = evaluate('openPickedEdge', {
    connections: [original], removingConnections, setEdgeCandidates: () => {}, onNodeTap: () => {},
    setEdgeEdit: (value: MapConnection) => { opened = value },
  }) as (item: MapEdge) => void
  open(edge(connection({ count: 1 })))
  assert.equal(opened, original)
  opened = null
  open(edge(connection({ id: 'removed' })))
  assert.equal(opened, null)
  removingConnections.current.add(original.id)
  open(edge(original))
  assert.equal(opened, null)
})

function controls(initialCollapsed = false, lastCollapsed = initialCollapsed) {
  const state = { collapsed: initialCollapsed, fitCalls: 0, expandCalls: 0, viewport: { w: 800, h: 600 } }
  const bindings: Record<string, any> = {
    cableLegendCollapsed: initialCollapsed, cableLegendCollapsedLast: lastCollapsed,
    cableLegendCollapsedRef: { current: initialCollapsed }, compactLegendViewportRef: { current: false },
    vp: { w: 800, h: 600 }, refitOnResizeRef: { current: false },
    activeNodeGesture: { current: null }, userAdjusted: { value: true },
    pinching: { value: false },
    onFitPress: () => { state.expandCalls++; return false },
    fit: () => { state.fitCalls++ },
    tryFit: () => { if (!bindings.userAdjusted.value) state.fitCalls++ },
    setViewportSize: (size: typeof state.viewport) => { state.viewport = size },
    setFocusedCableType: () => {},
    setCableLegendCollapsed: (next: boolean | ((current: boolean) => boolean)) => {
      state.collapsed = typeof next === 'function' ? next(state.collapsed) : next
    },
  }
  // 同一レンダーの連続イベントを再現するため、3つのハンドラーを同じ実行環境に置く。
  const names = ['setLegendCollapsed', 'toggleCableLegend', 'focusCableType', 'handleFitPress', 'onViewportLayout']
  const declarations = names.map(name => `const ${name} = ${initializer(name).getText(source)}`)
  const code = ts.transpileModule(`${declarations.join('\n')}\n({ toggleCableLegend, focusCableType, handleFitPress, onViewportLayout })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const handlers = runInNewContext(code, bindings) as {
    toggleCableLegend: () => void
    focusCableType: (type: string) => void
    handleFitPress: () => void
    onViewportLayout: (event: { nativeEvent: { layout: { width: number; height: number } } }) => void
  }
  return { state, bindings, ...handlers }
}

test('HUDを連打しても、2回の開閉操作が1回に潰れない', () => {
  const hud = controls(true)
  hud.toggleCableLegend()
  hud.toggleCableLegend()
  assert.equal(hud.state.collapsed, true)
})

test('種類の選択直後にHUDを押しても再展開できる', () => {
  const hud = controls(false)
  hud.focusCableType('HDMI')
  hud.toggleCableLegend()
  assert.equal(hud.state.collapsed, false)
})

test('別の配線図の保存状態に関係なく、表示中の展開HUDは狭い枠で閉じる', () => {
  const hud = controls(false, true)
  hud.onViewportLayout({ nativeEvent: { layout: { width: 320, height: 260 } } })
  assert.equal(hud.state.collapsed, true)
})

test('移動・リサイズ中の全体ボタンは倍率と写真を変更しない', () => {
  const hud = controls()
  hud.bindings.activeNodeGesture.current = 'resize-node'
  hud.handleFitPress()
  assert.equal(hud.state.fitCalls, 0)
  assert.equal(hud.state.expandCalls, 0)
  hud.bindings.activeNodeGesture.current = null
  hud.handleFitPress()
  assert.equal(hud.state.fitCalls, 1)
})

test('全体ボタンで手動調整を解除し、続く枠・レイアウトの更新にも全体表示を合わせる', () => {
  const hud = controls()
  hud.handleFitPress()
  assert.equal(hud.bindings.userAdjusted.value, false)
  hud.onViewportLayout({ nativeEvent: { layout: { width: 800, height: 700 } } })
  assert.equal(hud.state.fitCalls, 2)
})

test('ピンチ中の全体ボタンはカメラを変更せず、指を離した後に使える', () => {
  const hud = controls()
  hud.bindings.pinching.value = true
  hud.handleFitPress()
  assert.equal(hud.state.fitCalls, 0)
  assert.equal(hud.state.expandCalls, 0)
  assert.equal(hud.bindings.userAdjusted.value, true)
  hud.bindings.pinching.value = false
  hud.handleFitPress()
  assert.equal(hud.state.fitCalls, 1)
})
