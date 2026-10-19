import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(file: string, dependencies: (id: string) => any, globals: Record<string, any> = {}) {
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, require: dependencies, Error, Promise, ...globals })
  return module.exports
}

for (const os of ['ios', 'android', 'web']) {
  test(`${os}: 4つ以上の選択肢とキャンセルを残し、閉じた後に一度だけ実行する`, () => {
    const native: any[] = []
    const alerts = load('src/utils/alert.ts', () => ({ Platform: { OS: os }, Alert: { alert: (...args: any[]) => native.push(args) } }))
    const calls: string[] = []
    let changes = 0
    const unsubscribe = alerts.subscribeAlerts(() => changes++)
    const buttons = ['報告A', '報告B', '報告C', 'キャンセル'].map(text => ({ text, onPress: () => calls.push(text) }))
    alerts.Alert.alert('報告理由', '', buttons)
    const first = alerts.currentAlert()
    assert.equal(first.buttons.length, 4)
    assert.equal(native.length, 0)
    assert.deepEqual(calls, [])
    alerts.Alert.alert('報告理由', '', buttons)
    alerts.finishAlert(first, 3)
    assert.deepEqual(calls, ['キャンセル'])
    const second = alerts.currentAlert()
    assert.notEqual(second.id, first.id)
    alerts.finishAlert(first, 0)
    assert.deepEqual(calls, ['キャンセル'], '二重押下・古い閉じ通知を無視する')
    alerts.finishAlert(second, 1)
    assert.deepEqual(calls, ['キャンセル', '報告B'])
    assert.equal(alerts.currentAlert(), null)
    assert.equal(changes, 4)
    unsubscribe()
    alerts.Alert.alert('2択', '', buttons.slice(0, 2))
    assert.equal(os === 'web' ? alerts.currentAlert().buttons.length : native.length, os === 'web' ? 2 : 1)
  })
}

test('Webの通常確認・通知も共通ダイアログへ渡し、確認前に処理しない', () => {
  const dialogs: any[] = []
  const api = load('src/utils/confirmation.ts', id => id === './alert'
    ? { Alert: { alert: (...args: any[]) => dialogs.push(args) } }
    : { Platform: { OS: 'web' } })
  let confirmed = 0
  api.showConfirmation({ title: '削除', message: '確認', cancelLabel: '取消', confirmLabel: '削除', onConfirm: () => confirmed++ })
  assert.equal(confirmed, 0)
  assert.equal(dialogs[0][2][0].style, 'cancel')
  dialogs[0][2][1].onPress()
  assert.equal(confirmed, 1)
  api.showMessage('保存に失敗しました')
  assert.equal(dialogs[1][0], '保存に失敗しました')
})

for (const os of ['ios', 'android', 'web']) {
  test(`${os}: メニューの戻るはキャンセルし、閉じる完了前の連打で操作を実行しない`, () => {
    const alerts = load('src/utils/alert.ts', () => ({ Platform: { OS: os }, Alert: {} }))
    const calls: string[] = []
    alerts.Alert.alert('操作', '', ['A', 'B', 'C', '取消'].map((text, index) => ({
      text, style: index === 3 ? 'cancel' : 'default', onPress: () => calls.push(text),
    })))
    const request = alerts.currentAlert()
    const file = 'src/components/organisms/AlertHost.tsx'
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const component = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'AlertDialog')
    assert.ok(component)
    const slots: any[] = []
    const frames: Array<() => void> = []
    const effects: Array<() => void> = []
    let cursor = 0
    const jsx = (type: unknown, props: any) => ({ type, props })
    const code = ts.transpileModule(`exports.render = ${component.getText(source)}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    }).outputText
    const exported = {} as any
    runInNewContext(code, {
      exports: exported, require: () => ({ jsx, jsxs: jsx }),
      ...Object.fromEntries(['Modal', 'View', 'Pressable', 'ScrollView', 'Text'].map(name => [name, name])),
      useApp: () => ({ colors: {}, lang: 'ja' }), useSafeAreaInsets: () => ({ bottom: 0 }),
      useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = value }] },
      useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial } },
      useEffect: (effect: () => void) => effects.push(effect),
      requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length }, cancelAnimationFrame() {},
      Platform: { OS: os }, StyleSheet: {}, styles: {}, finishAlert: alerts.finishAlert,
    })
    const render = () => { cursor = 0; const tree = exported.render({ request }); effects.splice(0).forEach(effect => effect()); return tree }
    let tree = render()
    tree.props.onRequestClose()
    const buttons = tree.props.children.props.children[1].props.children.props.children[2]
    buttons[0].props.onPress()
    assert.deepEqual(calls, os === 'web' ? ['取消'] : [])
    tree = render()
    assert.equal(tree.props.visible, false)
    if (os === 'android') frames.forEach(callback => callback())
    else tree.props.onDismiss()
    assert.deepEqual(calls, ['取消'])
    tree.props.onDismiss()
    assert.deepEqual(calls, ['取消'])
  })
}

test('メール認証の退会入力はOS分岐せず、確定するまで待つ', async () => {
  const file = 'src/screens/SettingsScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let initializer: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'askDeletionPassword') initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(initializer)
  let email: string | null = null
  const resolver: { current: ((value: string | null) => void) | null } = { current: null }
  const exported = {} as any
  runInNewContext(ts.transpileModule(`exports.ask = ${initializer.getText(source)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exported, Promise, deletionPasswordResolver: resolver, setDeletionEmail: (value: string) => { email = value } })
  let settled = false
  const work = exported.ask('a@example.invalid').then((value: string) => { settled = true; return value })
  await Promise.resolve()
  assert.equal(email, 'a@example.invalid')
  assert.equal(settled, false)
  assert.ok(resolver.current)
  resolver.current('secret')
  assert.equal(await work, 'secret')
  const cancelled = exported.ask('a@example.invalid')
  resolver.current(null)
  assert.equal(await cancelled, null)
})

function sharing(share?: (data: any) => Promise<void>, copyResult = true) {
  const events: any[] = []
  const copied: string[] = []
  const messages: any[] = []
  const api = load('src/services/shareService.ts', id => {
    if (id === 'expo-clipboard') return { setStringAsync: () => assert.fail('Webのコピーは共通の代替処理を使う') }
    if (id.endsWith('/webClipboard')) return { copyWebText: async (value: string) => { copied.push(value); return copyResult } }
    if (id === 'react-native') return { Platform: { OS: 'web' }, Share: { share: () => assert.fail('WebはRNの.actionを参照しない') } }
    if (id.endsWith('/plans')) return { buildPublicUrl: () => 'https://example.invalid/desk', buildPublicProfileUrl: () => 'https://example.invalid/user' }
    if (id.endsWith('/share')) return { SHARE_HASHTAGS: { ja: '#MyDesk' } }
    if (id === './deskShareLinks') return { getDeskShareIdentifier: async () => 'id', getDeskShareUrl: async () => 'https://example.invalid/desk' }
    if (id === './analytics') return { analytics: { track: (...args: any[]) => events.push(args) }, EVENTS: { DESK_SHARED: 'shared', SHARE_CARD_COPIED: 'copied' } }
    if (id.endsWith('/haptics')) return { hapticLight() {} }
    if (id.endsWith('/confirmation')) return { showMessage: (...args: any[]) => messages.push(args) }
    return {}
  }, { navigator: share ? { share } : {} })
  return { api, events, copied, messages }
}

test('Webの共有成功はvoidでも成功とし、取消はコピー・成功記録をしない', async () => {
  let calls = 0
  const success = sharing(async () => { calls++ })
  await success.api.shareDesk({ deskId: 'desk', deskName: 'Desk' })
  assert.equal(calls, 1)
  assert.equal(success.events[0][1].method, 'share')
  assert.equal(success.copied.length, 0)
  const cancel = sharing(async () => { const error = new Error('cancel'); error.name = 'AbortError'; throw error })
  await cancel.api.shareDesk({ deskId: 'desk', deskName: 'Desk' })
  assert.equal(cancel.events.length, 0)
  assert.equal(cancel.copied.length, 0)
})

test('Web共有の非対応・拒否はリンクコピーへ移り、コピー失敗を成功扱いしない', async () => {
  for (const share of [undefined, async () => { throw new Error('NotAllowedError') }]) {
    const state = sharing(share)
    await state.api.shareDesk({ deskId: 'desk', deskName: 'Desk' })
    assert.deepEqual(state.copied, ['https://example.invalid/desk'])
    assert.equal(state.messages[0][0], 'リンクをコピーしました')
    assert.equal(state.events[0][1].method, 'copy')
  }
  const failed = sharing(undefined, false)
  await assert.rejects(failed.api.shareDesk({ deskId: 'desk', deskName: 'Desk' }), /Clipboard/)
  assert.equal(failed.events.length, 0)
  assert.equal(failed.messages[0][0], 'リンクをコピーできませんでした')
  assert.match(failed.messages[0][1], /https:\/\/example.invalid\/desk/)
})

test('WebコピーはAPI拒否時の代替処理でも実際の成否を返し、入力要素を残さない', async () => {
  for (const result of [true, false]) {
    let removed = 0
    let selected = 0
    let copied = ''
    const field = { value: '', style: {}, setAttribute() {}, select: () => selected++, remove: () => removed++ }
    const api = load('src/utils/webClipboard.ts', () => ({}), {
      navigator: { clipboard: { writeText: async () => { throw new Error('NotAllowedError') } } },
      document: {
        createElement: () => field, body: { appendChild() {} },
        execCommand: (command: string) => { assert.equal(command, 'copy'); copied = field.value; return result },
      },
    })
    assert.equal(await api.copyWebText('URL'), result)
    assert.equal(copied, 'URL')
    assert.equal(selected, 1)
    assert.equal(removed, 1)
  }
  const missing = load('src/utils/webClipboard.ts', () => ({}), { navigator: {} })
  assert.equal(await missing.copyWebText('URL'), false)
})

test('Webの明示的なリンクコピーも同じ代替処理を使い、失敗を記録しない', async () => {
  const state = sharing()
  assert.equal(await state.api.copyPublicUrl('desk'), 'https://example.invalid/desk')
  await state.api.copyPublicProfileUrl('owner')
  assert.deepEqual(state.copied, ['https://example.invalid/desk', 'https://example.invalid/user'])
  assert.equal(state.events.length, 1)
  assert.equal(state.events[0][0], 'copied')
  const failed = sharing(undefined, false)
  await assert.rejects(failed.api.copyPublicUrl('desk'), /Clipboard/)
  await assert.rejects(failed.api.copyPublicProfileUrl('owner'), /Clipboard/)
  assert.equal(failed.events.length, 0)
})
