import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { immediateRemoval } from './helpers/removalMotion'

const noop = () => {}
const components = ['CoachAnchor', 'View', 'Text', 'TouchableOpacity', 'DeskGridTile', 'SavedSwipeRow',
  'GadgetCard', 'FavoriteSwipeRow', 'RemovalMotion', 'CategoryIcon', 'BrandChip', 'AppIcon', 'Image']
const bindings = {
  ...Object.fromEntries(components.map(name => [name, name])),
  Animated: { View: 'AnimatedView' }, styles: {}, C: {}, colors: {}, lang: 'ja', ja: true, isDark: false,
  fmtPrice: String, t: String, UI_METRICS: { cardRadius: 16 }, labels: {}, scopeContentStyle: {}, contentTransitionStyle: {},
  collections: { assignmentButton: noop }, collectionAction: noop, displayMode: 'grid',
  ICONS: { chevronRight: 'chevron-right', close: 'close' },
  removal: immediateRemoval, removingIds: new Set(), releasingIds: new Set(), likedIds: new Set(), likeCounts: new Map(),
  changeByDeskId: new Map(), seen: {}, localizedDemoDeskName: (_id: string, name: string) => name,
  formatListTimestamp: String, toPhotoUrls: () => [], deskUpdateStamp: noop, hasUpdate: () => false,
  clapButtonLabel: String, toggleClap: noop, handleOpen: noop, toggleRelease: noop, handleToggleLike: noop,
  firstDeskId: 'first', firstGadgetKey: 'first', firstCardTarget: noop, rowTarget: noop, cardTarget: noop, removeTarget: noop,
  selectionMode: false, selectedIds: new Set(), libraryDeskLabel: () => '', libraryUsagePeriodLabel: () => '',
  openGadgetDetail: noop, beginSelectionWith: noop, toggleSelected: noop, toggleFavorite: noop,
  localizedGadgetName: (gadget: any) => gadget.name, SWIPE_OPEN_THRESHOLD: 40, categoryIconColor: () => '#000',
  navigation: { navigate: noop }, releaseWithUndo: noop, openItem: noop,
  useCoachTarget: (id: string) => id, cableLabel: String, portIconColor: () => '#000',
}

function renderer(file: string, marker: string) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === marker) callback = node
    if (ts.isVariableDeclaration(node) && ['renderItem', 'renderTile'].includes(node.name.getText(ast)) && node.initializer) {
      const candidate = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer
      if (candidate.getText(ast).includes(marker)) callback = candidate
    }
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'renderItem' && node.initializer
      && ts.isJsxExpression(node.initializer) && node.initializer.expression
      && ts.isArrowFunction(node.initializer.expression) && node.initializer.expression.getText(ast).includes(marker)) {
      callback = node.initializer.expression
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback, file)
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(ts.transpileModule(`(${callback.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText, { require: () => ({ jsx, jsxs: jsx }), exports: {}, ...bindings,
    libraryUsage: new Map([['second', { status: 'unused' }]]) }) as (item: any) => any
}

function anchors(tree: any): string[] {
  if (Array.isArray(tree)) return tree.flatMap(anchors)
  return !tree?.props ? [] : [
    ...(tree.type === 'CoachAnchor' ? [tree.props.id] : []), ...anchors(tree.props.children),
  ]
}

test('保存・閲覧履歴・持ち物・保存機材は2件目以降も案内対象にする', () => {
  const desk = { id: 'second', title: 'デスク', updated_at: '2026-10-01', purposes: [] }
  const cases = [
    { file: 'src/screens/BookmarkListScreen.tsx', marker: 'toPhotoUrls', targets: ['saved-card'],
      item: { item: { desk_id: 'second', desk }, index: 1 } },
    { file: 'src/screens/ViewHistoryListScreen.tsx', marker: 'desk_photos', targets: ['history-card'],
      item: { desk } },
    { file: 'src/screens/GadgetLibraryScreen.tsx', marker: 'libraryUsage.get', targets: ['gear-row'],
      item: { item: { type: 'gadget', _key: 'second', gadget: { id: 'second', name: 'モニター', category: 'Monitor' } }, index: 1 } },
    { file: 'src/components/organisms/GadgetBookmarkList.tsx', marker: 'gadget_category', targets: ['saved-gear', 'saved-gear-remove'],
      item: { item: { gadget_name: 'モニター', gadget_category: 'Monitor', desk_id: 'second', desk }, index: 1 } },
  ]
  for (const item of cases) {
    const found = anchors(renderer(item.file, item.marker)(item.item))
    for (const target of item.targets) assert.ok(found.includes(target), `${item.file}: ${target}`)
  }
})

test('マイデスク一覧は先頭以外のデスクも案内対象にする', () => {
  const refs = (tree: any): string[] => Array.isArray(tree) ? tree.flatMap(refs) : !tree?.props ? []
    : [...(typeof tree.props.ref === 'string' ? [tree.props.ref] : []), ...(tree.props.coachKey ? [`key:${tree.props.coachKey}`] : []), ...refs(tree.props.children)]
  const render = (plan: { id: string; wiringResult?: object }) => renderer('src/screens/PlanListScreen.tsx', 'renderCommitActions')({ item: { kind: 'plan', plan } })
  Object.assign(bindings, {
    coachTarget: (id: string) => id, isInProgress: (plan: { wiringResult?: object }) => !plan.wiringResult,
    SwipeCommitRow: 'SwipeCommitRow', publishStates: {}, swipeableRefs: { current: new Map() },
    togglePin: noop, renderLeftActions: noop, renderRightActions: noop, confirmDelete: noop, openPlanById: noop,
    startRename: noop, shareById: noop, continueById: noop,
  })
  assert.deepEqual(refs(render({ id: 'second', wiringResult: {} })), ['desk-card', 'key:desk-card'])
  assert.deepEqual(refs(render({ id: 'third' })), ['setup-draft'])
})

test('接続方法は本体付属と商品指定で実際に使える操作だけを案内対象にする', () => {
  const render = renderer('src/screens/ConnectionMethodScreen.tsx', 'ChoiceRow')
  const all = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(all)
    : !tree?.props ? [] : [tree, ...all(tree.props.children)]
  for (const choice of [undefined, { kind: 'included' }, { kind: 'product', name: 'ケーブル' }]) {
    const tree = all(render({ connection: { id: 'c', cableType: 'USB_C', cableChoice: choice },
      fromName: 'PC', toNames: ['Monitor'], colors: {}, lang: 'ja', isDark: false, onPickIncluded: noop, onClear: noop }))
    const refs = tree.map(node => node.props.ref).filter(Boolean)
    assert.ok(refs.includes('connection-row'))
    assert.equal(refs.includes('connection-included'), choice?.kind !== 'product')
    assert.equal(refs.includes('connection-clear'), choice?.kind === 'product')
  }
})
