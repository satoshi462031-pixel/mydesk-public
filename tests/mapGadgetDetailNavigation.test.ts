import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { baseMapNodeId, DECOR_ID, POWER_SOURCE_IDS } from '../src/utils/connectionMapLayout'

// ネイティブ描画に依存せず、画面に実装されたタップ処理と詳細画面の呼び出しを実行する。
function callback(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Missing callback ${name}`)
  const code = ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return runInNewContext(code, bindings) as (...args: any[]) => void
}

function fixture({ editable = true, pendingFrom = null as string | null } = {}) {
  const gadgets = [{ id: 'keyboard', category: 'Keyboard' }, { id: 'charger', category: 'Charger' }]
  const state = { gadget: null as (typeof gadgets)[number] | null, actions: null as any, pending: pendingFrom, method: null as any, edge: null as any, wireless: null as string | null, decorOpen: false }
  const open = callback('src/screens/WiringResultScreen.tsx', 'handleOpenMapGadget', {
    selectedGadgets: gadgets,
    setInfoGadget: (gadget: typeof state.gadget) => { state.gadget = gadget },
    setMapGadgetActions: (actions: typeof state.actions) => { state.actions = actions },
  })
  const tap = callback('src/components/organisms/ConnectionMap.tsx', 'onNodeTap', {
    baseMapNodeId, POWER_SOURCE_IDS, DECOR_ID, pendingFrom,
    wiringEditable: editable, byId: new Map(gadgets.map(gadget => [gadget.id, gadget])),
    onOpenGadget: open,
    setPendingFrom: (id: string | null) => { state.pending = id },
    setMethodFor: (method: unknown) => { state.method = method },
    setEdgeEdit: (connection: unknown) => { state.edge = connection },
    setWirelessPickerFor: (id: string) => { state.wireless = id },
    setDecorListOpen: (visible: boolean) => { state.decorOpen = visible },
  })
  return { state, tap }
}

test('配線図のタップでガジェット詳細を直接開き、非表示の接続も編集できる', () => {
  const { state, tap } = fixture()
  tap('keyboard')
  assert.equal(state.gadget?.id, 'keyboard')
  const connection = { id: 'wifi', cableType: 'WiFi' }
  state.actions.actions.editConnection(connection)
  assert.equal(state.edge, connection)
  state.actions.actions.drawConnection()
  assert.equal(state.pending, 'keyboard')
  assert.equal(state.actions.actions.addWirelessConnection, undefined)
})

test('分割キーボードの左右から同じガジェット詳細を開く', () => {
  for (const id of ['keyboard__L', 'keyboard__R']) {
    const { state, tap } = fixture()
    tap(id)
    assert.equal(state.gadget?.id, 'keyboard')
  }
})

test('閲覧・配置モードでは詳細だけを開き、配線の編集操作を渡さない', () => {
  const { state, tap } = fixture({ editable: false })
  tap('charger')
  assert.equal(state.gadget?.id, 'charger')
  assert.equal(state.actions, null)
})

test('充電器の詳細からワイヤレス充電を追加できる', () => {
  const { state, tap } = fixture()
  tap('charger')
  state.actions.actions.addWirelessConnection()
  assert.equal(state.wireless, 'charger')
})

test('線を引く途中のタップは詳細を開かず、接続先を選ぶ', () => {
  const { state, tap } = fixture({ pendingFrom: 'keyboard' })
  tap('charger')
  assert.equal(state.gadget, null)
  assert.equal(state.method.from, 'keyboard')
  assert.equal(state.method.to, 'charger')
  assert.equal(state.pending, null)
  const same = fixture({ pendingFrom: 'keyboard' })
  same.tap('keyboard')
  assert.equal(same.state.method, null)
  assert.equal(same.state.pending, null)
})

test('電源と飾りグループはガジェット詳細として開かない', () => {
  for (const id of POWER_SOURCE_IDS) {
    const { state, tap } = fixture({ pendingFrom: 'keyboard' })
    tap(id)
    assert.equal(state.gadget, null)
    assert.equal(state.pending, null)
  }
  const { state, tap } = fixture()
  tap(DECOR_ID)
  assert.equal(state.gadget, null)
  assert.equal(state.decorOpen, true)
})
