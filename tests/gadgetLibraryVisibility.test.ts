import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const file = 'src/screens/GadgetLibraryScreen.tsx'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let header: ts.Expression | undefined
let content: ts.ConditionalExpression | undefined
let controls: ts.FunctionDeclaration | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'ListHeader') header = node.initializer
  // 検索・使用状況・お気に入りの列は部品に分けてある。その部品も描いて、中の切り替えを確かめる
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'GadgetLibraryHeaderControls') controls = node
  if (ts.isConditionalExpression(node) && node.condition.getText(source) === 'libraryLoading') content = node
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(header && content && controls)
const code = ts.transpileModule(`${controls.getText(source)}; const ListHeader = ${header.getText(source)}; (${content.getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText

type Node = { type: string; props: Record<string, any> }
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children), ...nodes(value.props.ListHeaderComponent)] : []
}
function render(state: Record<string, unknown>, ja: boolean) {
  const jsx = (type: string | ((props: Record<string, any>) => unknown), props: Record<string, any>) =>
    typeof type === 'function' ? type(props) : ({ type, props })
  const noop = () => {}
  let selected = ''
  const tree = runInNewContext(code, {
    exports: {}, require: () => ({ jsx, jsxs: jsx }),
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', SearchField: 'SearchField',
    SegmentedControl: 'SegmentedControl', AppIcon: 'AppIcon', GadgetListChoiceButton: 'GadgetListChoiceButton',
    ListSkeleton: 'ListSkeleton', RetryState: 'RetryState', EmptyState: 'EmptyState', AdBanner: 'AdBanner',
    Animated: { ScrollView: 'ScrollView', FlatList: 'FlatList' },
    headerSlot: jsx('Profile', {}), styles: {}, colors: {}, ICONS: {}, ja,
    selectionMode: false, search: '', favoritesOnly: false, canGroupByBrand: false,
    searchTarget: null, searchInputRef: null, usageTarget: null, favoritesTarget: null, trashTarget: null,
    onOpenStats: undefined, setSearch: noop, t: (key: string) => key,
    usageCounts: { current: 1, unused: 3 }, usageFilter: 'current',
    useApp: () => ({ colors: {}, lang: ja ? 'ja' : 'en', t: (key: string) => key }),
    statsTarget: null, groupTarget: null, ownedCount: 0, currentGroupLabel: '', groupSheetOpen: false,
    swipeableRefs: { current: new Map() }, leaveSelectionMode: noop,
    setUsageFilter: (value: string) => { selected = value },
    scrollIndicatorInsets: {}, active: true, fallbackScrollRef: {}, listRef: {},
    scrollSyncHandlers: {}, scrollActive: true, onScroll: noop, minimumContentHeight: undefined,
    libraryLoading: false, libraryLoadError: false, plansLoadError: false,
    gadgets: [{}], deletedGadgets: [], listData: [], filteredGadgets: [], renderItem: noop,
    openAddGadget: noop, ...state,
  })
  return { tree, selected: () => selected }
}

test('使用中・未使用は読み込み中・取得失敗・登録0件・一覧0件でも表示し、切り替えできる', () => {
  const states = [
    { libraryLoading: true, gadgets: [] },
    { libraryLoadError: true, gadgets: [] },
    { libraryLoadError: true, plansLoadError: true },
    { gadgets: [] },
    { gadgets: [], deletedGadgets: [{}] },
    {},
  ]
  for (const ja of [true, false]) for (const state of states) {
    const rendered = render(state, ja)
    const visible = nodes(rendered.tree)
    const switches = visible.filter((node) => node.type === 'SegmentedControl')
    assert.equal(switches.length, 1, JSON.stringify({ state, ja }))
    assert.equal(visible.filter((node) => node.type === 'Profile').length, 1)
    assert.deepEqual(Array.from(switches[0].props.options, (option: any) => option.label), ja
      ? ['使用中 1', '未使用 3']
      : ['In use 1', 'Unused 3'])
    switches[0].props.onChange('unused')
    assert.equal(rendered.selected(), 'unused')
    const unused = render({ ...state, usageFilter: 'unused' }, ja)
    nodes(unused.tree).find((node) => node.type === 'SegmentedControl')!.props.onChange('current')
    assert.equal(unused.selected(), 'current')
  }
})
