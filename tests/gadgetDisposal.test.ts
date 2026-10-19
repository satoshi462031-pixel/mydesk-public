import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function expression(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(initializer)
  const code = ts.transpileModule(`(${initializer.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: string, props: any) => ({ type, props })
  return runInNewContext(code, {
    exports: {}, require: () => ({ jsx, jsxs: jsx }), useCallback: (fn: unknown) => fn,
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', styles: {}, ...bindings,
  })
}
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}

test('未使用のスワイプには処分、処分済みには取消を出し、使用中には処分を出さない', () => {
  const disposed: string[] = []
  let closed = 0
  const render = (used: boolean) => expression('src/screens/GadgetLibraryScreen.tsx', 'renderRightActions', {
    Animated: { View: 'AnimatedView' }, ja: true, ICONS: {}, UI_STATUS_COLORS: {}, UI_STATUS_ON_WARNING: '#000000',
    swipeRevealStyle: () => ({}), usedGadgetIds: new Set(used ? ['g'] : []),
    swipeableRefs: { current: new Map([['g', { close: () => { closed++ } }]]) },
    confirmDeleteGadget: () => {}, retireWithUndo: () => {}, toggleDisposal: (gadget: any) => disposed.push(gadget.id),
  })
  const unused = nodes(render(false)({ id: 'g' }, {}))
  unused.find((node) => node.props.accessibilityLabel === '処分').props.onPress()
  assert.deepEqual(disposed, ['g'])
  assert.equal(closed, 1)
  assert.ok(nodes(render(false)({ id: 'g', disposedAt: '2026-10-17' }, {}))
    .some((node) => node.props.accessibilityLabel === '処分済みを取り消す'))
  assert.ok(nodes(render(true)({ id: 'g' }, {})).every((node) => node.props.accessibilityLabel !== '処分'))
})

test('処分済みのカードは名前の横にアイコンと処分済みの表示を付け、読み上げでも区別する', () => {
  for (const lang of ['ja', 'en']) {
    const render = expression('src/components/molecules/GadgetCard.tsx', 'GadgetCard', {
      React: { memo: (fn: unknown) => fn },
      useApp: () => ({ colors: {}, isDark: false, lang }),
      categoryBaseColor: () => '#888888', categoryIconColor: () => '#888888', getPortSummary: () => null,
      localizedGadgetName: (gadget: any) => gadget.name, customCategoryOf: () => null,
      CATEGORY_LABELS: {}, CATEGORY_LABELS_EN: {}, notOwnedBadge: () => undefined,
      useLongPressGuard: () => ({}), StyleSheet: {}, PRESS_INTERACTION: {}, UI_METRICS: {},
      CategoryIcon: 'CategoryIcon', FavoriteGadgetMark: 'FavoriteGadgetMark',
    })
    const normal = render({ gadget: { id: 'g', name: 'Monitor' } })
    const disposed = render({ gadget: { id: 'g', name: 'Monitor', disposedAt: '2026-10-17' } })
    assert.ok(nodes(normal).every((node) => node.props.name !== 'package-variant-closed-remove'))
    assert.ok(nodes(disposed).some((node) => node.props.name === 'package-variant-closed-remove'))
    assert.ok(nodes(disposed).some((node) => node.type === 'Text' && node.props.children === (lang === 'ja' ? '処分済み' : 'Disposed')))
    assert.ok(disposed.props.accessibilityLabel.includes(lang === 'ja' ? '処分済み' : 'disposed'))
  }
})

test('処分の連打を重ねず、取り消しで処分前の状態へ戻す', async () => {
  let finish!: (gadget: any) => void
  let writes = 0
  let undo: any
  const gadget = { id: 'g', name: 'Monitor' }
  let saved: any = gadget
  const toggle = expression('src/screens/GadgetLibraryScreen.tsx', 'toggleDisposal', {
    usedGadgetIds: new Set(), disposingGadgetIdsRef: { current: new Set() }, ja: true, lang: 'ja',
    localizedGadgetName: (item: any) => item.name, hapticSelection: () => {}, setInfoGadget: () => {},
    showMessage: () => assert.fail('保存成功時にエラーを出している'),
    undoSnackbar: { showUndo: (value: any) => { undo = value } },
    setDisposedAt: async (_id: string, disposedAt?: string) => {
      writes++
      if (writes === 1) await new Promise((resolve) => { finish = resolve })
      saved = { ...saved, disposedAt }
      return saved
    },
  })
  const pending = toggle(gadget)
  await toggle(gadget)
  assert.equal(writes, 1)
  finish(gadget)
  await pending
  assert.ok(saved.disposedAt)
  assert.ok(undo.message.includes('処分済み'))
  await undo.onUndo()
  assert.equal(saved.disposedAt, undefined)
  assert.equal(saved.name, 'Monitor')
})
