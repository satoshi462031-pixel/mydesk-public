import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const noop = () => {}
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}

function placement(category: string) {
  const ast = ts.createSourceFile('screen.tsx', readFileSync('src/screens/DeskPlacementScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DeskPlacementScreen')!
  const plan = { id: 'desk', selectedGadgetIds: ['gear'], connectionMap: { connections: [] }, images: [] }
  let stateIndex = 0
  let focused = true
  let saves = 0
  const destinations: any[][] = []
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const render = runInNewContext(ts.transpileModule(`(${component.getText(ast).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports: {}, require: () => ({ jsx, jsxs: jsx }), Date,
    useSpotlightTarget: () => null, useApp: () => ({ colors: {}, lang: 'ja' }),
    usePlans: () => ({ loading: false, loadError: false, getById: () => plan,
      updateWith: async () => { saves++ }, reload: noop }),
    useGadgets: () => ({ gadgets: [{ id: 'gear', category }], loading: false, loadError: false, reload: noop }),
    useState: (initial: unknown) => [stateIndex++ === 4 ? [] : initial, noop],
    useRef: (current: unknown) => ({ current }), useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn, useEffect: noop,
    applyDeskGadgetUsage: (_plan: unknown, gadget: unknown) => gadget,
    SafeAreaView: 'SafeAreaView', SetupScreenHelp: 'SetupScreenHelp', SetupProgress: 'SetupProgress',
    View: 'View', Text: 'Text', ConnectionMap: 'ConnectionMap', SetupActionFooter: 'SetupActionFooter',
    styles: {}, PLACEMENT_MOVE_HINT: { ja: '', en: '' },
    pauseForPaint: async () => {}, generateWiring: () => ({ connections: [], requiredCables: [], warnings: [] }),
    reconcileMap: () => [], saveFirstSetupDraft: async () => {}, hapticSuccess: noop,
    analytics: { track: noop }, EVENTS: {}, errorProperties: () => ({}),
  })
  const tree = render({ route: { params: { planId: 'desk' } }, navigation: {
    isFocused: () => focused, replace: (...args: unknown[]) => destinations.push(args),
  } })
  return { tree, destinations, saves: () => saves, blur: () => { focused = false } }
}

test('ケーブルだけのデスクでも配置完了のボタンを表示し、写真へ進める', async () => {
  const h = placement('Cable')
  const map = nodes(h.tree).find(node => node.type === 'ConnectionMap')!
  assert.equal(map.props.gadgets.length, 0)
  const footer = nodes(h.tree).find(node => node.type === 'SetupActionFooter')
  assert.ok(footer, '配置対象が0件でも完了操作を表示する')
  footer.props.onPress()
  await flush()
  assert.equal(h.saves(), 1)
  assert.equal(h.destinations[0][0], 'PhotoFill')
})

test('配置対象がある場合はキャンバス内の通常の完了ボタンを使う', () => {
  const h = placement('PC')
  assert.equal(nodes(h.tree).some(node => node.type === 'SetupActionFooter'), false)
  assert.equal(nodes(h.tree).find(node => node.type === 'ConnectionMap')!.props.gadgets.length, 1)
})

test('空の配置を離れた後の古い完了操作では保存も遷移もしない', async () => {
  const h = placement('Cable')
  const footer = nodes(h.tree).find(node => node.type === 'SetupActionFooter')!
  assert.ok(footer)
  h.blur()
  footer.props.onPress()
  await flush()
  assert.equal(h.saves(), 0)
  assert.equal(h.destinations.length, 0)
})
