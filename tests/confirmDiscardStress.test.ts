import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const file = 'src/hooks/useConfirmDiscard.ts'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
const code = ts.transpileModule(source.statements.filter(ts.isFunctionDeclaration).map(node =>
  node.getText(source).replace(/^export /, '')).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

function harness() {
  const slots: any[] = []
  const alerts: any[] = []
  const dispatched: unknown[] = []
  let cursor = 0
  let dirty = true
  let focused = true
  let listener: ((event: any) => void) | undefined
  let cleanup: (() => void) | undefined
  const beforeRemove = (action: unknown) => {
    let prevented = false
    listener?.({ data: { action }, preventDefault: () => { prevented = true } })
    return prevented
  }
  const navigation = {
    isFocused: () => focused,
    addListener: (_name: string, run: (event: any) => void) => { listener = run; return () => { listener = undefined } },
    dispatch: (action: unknown) => { if (!beforeRemove(action)) dispatched.push(action) },
  }
  const runtime: Record<string, any> = {
    useRef: (current: unknown) => slots[cursor++] ??= { current },
    useEffect: (run: () => () => void) => { cleanup ??= run() },
    Alert: { alert: (...args: any[]) => { alerts.push(args) } },
  }
  runInNewContext(code, runtime)
  const render = () => { cursor = 0; runtime.useConfirmDiscard(navigation, () => dirty, 'ja') }
  render()
  return { alerts, dispatched, beforeRemove, render, clean: () => { dirty = false; render() }, unmount: () => cleanup?.(),
    focus: (next: boolean) => { focused = next } }
}

test('戻るの連打は一つの確認にまとまり、破棄を連打しても一度だけ遷移する', () => {
  const h = harness()
  const action = { type: 'GO_BACK' }
  for (let i = 0; i < 100; i++) assert.equal(h.beforeRemove(action), true)
  assert.equal(h.alerts.length, 1)
  for (let i = 0; i < 100; i++) h.alerts[0][2][1].onPress()
  assert.deepEqual(h.dispatched, [action])
})

test('キャンセル・閉じるの後は再確認でき、古い確認は次の操作に影響しない', () => {
  for (const dismiss of [false, true]) {
    const h = harness()
    h.beforeRemove('old')
    const old = h.alerts[0]
    if (dismiss) old[3].onDismiss()
    else old[2][0].onPress()
    h.beforeRemove('new')
    assert.equal(h.alerts.length, 2)
    old[2][1].onPress()
    old[2][0].onPress()
    assert.equal(h.dispatched.length, 0)
    assert.equal(h.beforeRemove('third'), true)
    assert.equal(h.alerts.length, 2)
    h.alerts[1][2][1].onPress()
    assert.deepEqual(h.dispatched, ['new'])
  }
})

test('保存完了後や画面を閉じた後に古い破棄確認を押しても追加で戻らない', () => {
  for (const unmount of [false, true]) {
    const h = harness()
    h.beforeRemove('old')
    if (unmount) h.unmount()
    else { h.clean(); assert.equal(h.beforeRemove('saved'), false) }
    h.alerts[0][2][1].onPress()
    assert.equal(h.dispatched.length, 0)
  }
})

test('別画面で古い破棄確認を押しても戻らず、復帰後は改めて確認して戻れる', () => {
  const h = harness()
  h.beforeRemove('old')
  h.focus(false)
  h.alerts[0][2][1].onPress()
  assert.equal(h.dispatched.length, 0)
  h.focus(true)
  h.beforeRemove('new')
  assert.equal(h.alerts.length, 2)
  h.alerts[0][2][1].onPress()
  assert.equal(h.dispatched.length, 0)
  h.alerts[1][2][1].onPress()
  assert.deepEqual(h.dispatched, ['new'])
})
