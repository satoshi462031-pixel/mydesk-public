import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { gadgetFromProduct } from '../src/utils/gadgetFromProduct'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'
import type { GadgetCategory } from '../src/types'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function source(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function evaluate(code: string, bindings: Record<string, any>) {
  return runInNewContext(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, bindings)
}
const orderSource = source('src/constants/categoryOrder.ts')
const order = evaluate(`${orderSource.statements.filter(node => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some(item => ['CATEGORY_SECTIONS', 'CATEGORY_SELECTION_ORDER', 'DEFAULT_ADVANCED_CATEGORIES'].includes(item.name.getText(orderSource))))
  .map(node => node.getText(orderSource).replace(/^export /, '')).join('\n')}; ({ CATEGORY_SECTIONS, CATEGORY_SELECTION_ORDER, DEFAULT_ADVANCED_CATEGORIES })`, {})

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}
function session(code: string, bindings: Record<string, any>) {
  const slots: any[] = []
  const dependencies: unknown[][] = []
  const effects = new Map<number, () => void>()
  let cursor = 0
  let dirty = false
  const jsx = (type: unknown, props: any) => ({ type, props })
  const effect = (run: () => void, next: unknown[]) => {
    const slot = cursor++
    if (!dependencies[slot] || next.some((value, i) => value !== dependencies[slot][i])) effects.set(slot, run)
    dependencies[slot] = next
  }
  const render = evaluate(code, {
    exports: {}, require: () => ({ jsx, jsxs: jsx, Fragment: 'Fragment' }),
    useState: (initial: any) => {
      const slot = cursor++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], (next: any) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; dirty = true }]
    },
    useRef: (current: unknown) => slots[cursor++] ??= { current }, useEffect: effect, useLayoutEffect: effect,
    useCallback: (fn: unknown, next: unknown[]) => {
      const slot = cursor++
      if (!dependencies[slot] || next.some((value, i) => value !== dependencies[slot][i])) slots[slot] = fn
      dependencies[slot] = next
      return slots[slot]
    }, useMemo: (fn: () => unknown) => fn(),
    ...bindings,
  })
  return (props: any = {}) => {
    for (let i = 0; i < 8; i++) {
      cursor = 0; dirty = false
      const tree = render(props)
      const next = [...effects.values()]; effects.clear(); next.forEach(fn => fn())
      if (!dirty) return tree
    }
    throw new Error('Category selection render did not settle')
  }
}
const componentBindings = Object.fromEntries(['SafeAreaView', 'KeyboardAvoidingView', 'CategorySectionPicker', 'SearchField',
  'ScrollView', 'Modal', 'View', 'Text', 'TouchableOpacity', 'AppIcon', 'CategoryIcon', 'FlatList', 'HeaderIconButton',
  'ActivityIndicator', 'Image', 'BrandChip', 'Button', 'MissingIntroductionDateSheet', 'BottomSheetModal', 'CustomCategoryEditor', 'IconCircleButton', 'CoachAnchor', 'CoachScope']
  .map(name => [name, name]))
function componentCode(file: string, name: string) {
  return `(${source(file).statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!.getText().replace(/^export /, '')})`
}
const custom = { id: 'stand', name: '台', icon: 'desk-monitor-shelf', color: '#159D67' }
function addScreen(platform: string, direct = true) {
  const calls: any[] = []
  const timers: (() => void)[] = []
  const listeners = new Map<string, ((event?: any) => void)[]>()
  let focused = true
  let backs = 0
  let nextId = 0
  let header: any
  const navigation = {
    isFocused: () => focused, navigate: (...args: unknown[]) => calls.push(args), goBack: () => { backs++ },
    setOptions: (options: any) => { header = options },
    addListener: (name: string, fn: () => void) => { listeners.set(name, [...listeners.get(name) ?? [], fn]); return () => {} },
  }
  const render = session(componentCode('src/screens/AddGadgetScreen.tsx', 'AddGadgetScreen'), {
    ...componentBindings, styles: {}, ICONS: {}, RESULT_LIMIT: 30, PRODUCT_BROWSE_ENABLED: false, Platform: { OS: platform },
    useHeaderHeight: () => 0, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    useApp: () => ({ colors: {}, lang: 'ja', t: String }),
    useGadgets: () => ({ gadgets: [], add: () => assert.fail('選ぶだけで登録している') }),
    usePlans: () => ({ plans: [], updateWith: () => assert.fail('選ぶだけでデスクを変更している') }),
    usePlanOpenedAt: () => ({}), sortPlansLikeMyDesk: () => [], gadgetFromProduct, uuidv4: () => `draft-${++nextId}`,
    analytics: { track: () => {} }, EVENTS: {},
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length }, clearTimeout: () => {},
    useProductSuggestionsState: () => ({ suggestions: [], loading: false, error: false }),
    useCoachMarks: () => ({ target: () => undefined, open: async () => {}, overlay: null }), COACH_SCREEN: '__screen', ADD_GADGET_COACH: [],
  })
  const paint = () => render({ route: { params: { showCategoryPicker: direct } }, navigation })
  paint()
  return { paint, calls, backs: () => backs, header: () => header,
    focus: () => { focused = true; listeners.get('focus')?.forEach(fn => fn()) },
    leave: () => { focused = false; listeners.get('beforeRemove')?.forEach(fn => fn()) },
    flushTimers: () => { timers.splice(0).forEach(fn => fn()) },
    flushNextTimer: () => { timers.shift()?.() },
  }
}
function picker(fail = false) {
  const alerts: any[] = []
  const selected: unknown[] = []
  const toggled: unknown[] = []
  let resets = 0
  const render = session(componentCode('src/components/organisms/CategorySectionPicker.tsx', 'CategorySectionPicker'), {
    ...componentBindings, ...order, styles: {}, ICONS: {}, SCREEN_W: 390, QUANTITY_BUTTON_DIAMETER: 22,
    PRESS_INTERACTION: { longPressDelay: 400 }, categoryIconColor: () => '#123456', hapticMedium: () => {},
    useCustomCategories: () => ({ categories: [custom] }),
    useApp: () => ({ colors: {}, lang: 'ja', t: String, isAdvancedCategory: (cat: string) => order.DEFAULT_ADVANCED_CATEGORIES.includes(cat),
      toggleAdvancedCategory: async (cat: string) => { toggled.push(cat); if (fail) throw new Error('disk full') },
      resetAdvancedCategories: async () => { resets++; if (fail) throw new Error('disk full') } }),
    Alert: { alert: (...args: any[]) => alerts.push(args) },
  })
  const paint = (layout = 'grid') => render({ layout, onSelect: (cat: unknown) => selected.push(cat), onSelectCustom: (cat: unknown) => selected.push(cat) })
  const button = (tree: any, text: string) => nodes(tree).find(node => node.type === 'TouchableOpacity' && nodes(node).some(child => child.type === 'Text' && child.props.children === text))!
  return { paint, button, alerts, selected, toggled, resets: () => resets }
}

test('標準・自作ジャンルのランダム連打は最初に選んだ一件だけを開き、戻ったら選び直せる', () => {
  for (const platform of ['ios', 'android', 'web']) for (const seed of CONTROL_TEST_SEEDS) {
    const h = addScreen(platform)
    const random = seededRandom(seed)
    for (let round = 0; round < 5; round++) {
      const select = nodes(h.paint()).find(node => node.type === 'CategorySectionPicker')!.props
      const first: GadgetCategory = order.CATEGORY_SELECTION_ORDER[random(order.CATEGORY_SELECTION_ORDER.length)]
      select.onSelect(first)
      for (let i = 0; i < 100; i++) {
        if (random(2)) select.onSelectCustom(custom)
        else select.onSelect(order.CATEGORY_SELECTION_ORDER[random(order.CATEGORY_SELECTION_ORDER.length)])
        if (random(4) === 0) h.paint()
      }
      assert.equal(h.calls.length, round + 1)
      assert.equal(h.calls[round][1].draftGadget.category, first)
      h.focus()
    }
  }
})

test('モーダルを閉じる途中の連打でも最初のジャンルを維持し、閉じた後の古い札では開かない', () => {
  for (const platform of ['ios', 'android', 'web']) {
    const h = addScreen(platform, false)
    const browse = nodes(h.paint()).find(node => node.type === 'TouchableOpacity' && nodes(node).some(child => child.type === 'Text' && child.props.children === 'ジャンルを選択'))!
    browse.props.onPress()
    const tree = h.paint()
    const modal = nodes(tree).find(node => node.type === 'Modal')!
    const select = nodes(tree).find(node => node.type === 'CategorySectionPicker')!.props
    select.onSelect('Monitor')
    for (let i = 0; i < 80; i++) select.onSelectCustom(custom)
    h.flushTimers(); modal.props.onDismiss()
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0][1].draftGadget.category, 'Monitor')

    const closed = addScreen(platform, false)
    nodes(closed.paint()).find(node => node.type === 'TouchableOpacity' && nodes(node).some(child => child.type === 'Text' && child.props.children === 'ジャンルを選択'))!.props.onPress()
    const old = nodes(closed.paint())
    old.find(node => node.type === 'Modal')!.props.onRequestClose()
    old.find(node => node.type === 'CategorySectionPicker')!.props.onSelect('Mouse')
    closed.flushTimers(); old.find(node => node.type === 'Modal')!.props.onDismiss()
    assert.equal(closed.calls.length, 0)
  }
})

test('ジャンル選択の戻る連打と選択を混ぜても前の画面まで閉じず、詳細も開かない', () => {
  const h = addScreen('ios')
  const select = nodes(h.paint()).find(node => node.type === 'CategorySectionPicker')!.props
  const back = h.header().headerLeft().props.onPress
  for (let i = 0; i < 100; i++) { back(); select.onSelect('Mouse') }
  assert.equal(h.backs(), 1)
  assert.equal(h.calls.length, 0)
})

test('前のモーダルの遅延処理・古い札は、新しい選択や閉じた画面を開かない', () => {
  for (const platform of ['android', 'web']) {
    const h = addScreen(platform, false)
    const open = () => nodes(h.paint()).find(node => node.type === 'TouchableOpacity' && nodes(node).some(child => child.type === 'Text' && child.props.children === 'ジャンルを選択'))!.props.onPress()
    open()
    const first = nodes(h.paint())
    first.find(node => node.type === 'CategorySectionPicker')!.props.onSelect('Mouse')
    first.find(node => node.type === 'Modal')!.props.onDismiss()
    assert.equal(h.calls.length, 1)
    h.focus()
    open()
    const second = nodes(h.paint())
    first.find(node => node.type === 'CategorySectionPicker')!.props.onSelect('PC')
    second.find(node => node.type === 'CategorySectionPicker')!.props.onSelect('Monitor')
    h.flushNextTimer()
    assert.equal(h.calls.length, 1)
    h.flushTimers()
    assert.equal(h.calls.length, 2)
    assert.equal(h.calls[1][1].draftGadget.category, 'Monitor')
    h.focus()
    open()
    nodes(h.paint()).find(node => node.type === 'CategorySectionPicker')!.props.onSelect('Desk')
    h.leave()
    h.flushTimers()
    assert.equal(h.calls.length, 2)
  }
})

test('編集の切り替え直後の札は詳細を開かず、詳細欄の開閉はランダム連打の回数と一致する', () => {
  for (const layout of ['grid', 'list']) {
    const h = picker()
    const tree = h.paint(layout)
    h.button(tree, 'common.edit').props.onPress()
    h.button(tree, 'category.Mouse').props.onPress()
    assert.deepEqual(h.selected, [])
    assert.deepEqual(h.toggled, ['Mouse'])
    h.button(h.paint(layout), 'common.done').props.onPress()
    let expanded = false
    for (const seed of CONTROL_TEST_SEEDS) {
      const random = seededRandom(seed)
      for (let batch = 0; batch < 100; batch++) {
        const toggle = h.button(h.paint(layout), 'catPicker.advanced').props.onPress
        for (let i = 0, n = 1 + random(8); i < n; i++) { toggle(); expanded = !expanded }
        assert.equal(h.button(h.paint(layout), 'catPicker.advanced').props.accessibilityState.expanded, expanded)
      }
    }
  }
})

test('振り分けのリセット確認を連打しても一つだけ表示し、古い確認を再利用しない', async () => {
  const h = picker()
  h.button(h.paint(), 'common.edit').props.onPress()
  const reset = h.button(h.paint(), 'catPicker.reset').props.onPress
  for (let i = 0; i < 100; i++) reset()
  assert.equal(h.alerts.length, 1)
  h.alerts[0][2][0].onPress()
  reset()
  h.alerts[0][2][1].onPress()
  assert.equal(h.resets(), 0)
  for (let i = 0; i < 100; i++) h.alerts[1][2][1].onPress()
  await flush()
  assert.equal(h.resets(), 1)
})

test('自作ジャンルの長押し・編集切り替えは選択と混ざらず、閉じた後は再選択できる', () => {
  for (const layout of ['grid', 'list']) {
    const h = picker()
    const button = h.button(h.paint(layout), custom.name).props
    button.onPressIn(); button.onLongPress(); button.onPress()
    assert.equal(h.selected.length, 0)
    let editor = nodes(h.paint(layout)).find(node => node.type === 'CustomCategoryEditor')!.props
    assert.equal(editor.visible, true)
    assert.equal(editor.editing, custom)
    editor.onClose()
    const tree = h.paint(layout)
    h.button(tree, 'common.edit').props.onPress()
    h.button(tree, custom.name).props.onPress()
    assert.equal(h.selected.length, 0)
    editor = nodes(h.paint(layout)).find(node => node.type === 'CustomCategoryEditor')!.props
    editor.onClose()
    h.button(h.paint(layout), 'common.done').props.onPress()
    const select = h.button(h.paint(layout), custom.name).props
    select.onPressIn(); select.onPress()
    assert.deepEqual(h.selected, [custom])
  }
})

test('保存失敗を連打してもエラーを積み重ねず、リセット失敗後も再試行できる', async () => {
  const h = picker(true)
  h.button(h.paint(), 'common.edit').props.onPress()
  const tree = h.paint()
  for (let i = 0; i < 100; i++) h.button(tree, 'category.Mouse').props.onPress()
  await flush()
  assert.equal(h.alerts.length, 1)
  h.alerts[0][2][0].onPress()
  h.button(tree, 'catPicker.reset').props.onPress()
  h.alerts[1][2][1].onPress()
  await flush()
  assert.equal(h.resets(), 1)
  assert.equal(h.alerts.length, 3)
  h.alerts[2][2][0].onPress()
  h.button(tree, 'catPicker.reset').props.onPress()
  h.alerts[3][2][1].onPress()
  await flush()
  assert.equal(h.resets(), 2)
})

function advancedState(saveAdvancedCategories: (value: GadgetCategory[]) => Promise<void>) {
  const parsed = source('src/context/AppContext.tsx')
  const provider = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'AppProvider')!
  const names = ['advancedCategories', 'advancedCategoriesRef', 'advancedCategoriesSavedRef', 'advancedCategoriesWriteRef', 'persistAdvancedCategories', 'toggleAdvancedCategory', 'resetAdvancedCategories']
  const declarations = provider.body!.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item =>
    names.some(name => item.name.getText(parsed) === name || item.name.getText(parsed).startsWith(`[${name},`))))
  return session(`(function () {${declarations.map(node => node.getText(parsed)).join('\n')}; return { advancedCategories, toggleAdvancedCategory, resetAdvancedCategories }})`, {
    ...order, saveAdvancedCategories,
  })
}

test('振り分けを再描画前に連打しても全て反映し、保存を同時に走らせない', async () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const writes: { value: GadgetCategory[]; resolve: () => void }[] = []
    const render = advancedState(value => new Promise<void>(resolve => writes.push({ value: [...value], resolve })))
    let frame = render()
    let model: GadgetCategory[] = [...order.DEFAULT_ADVANCED_CATEGORIES]
    const random = seededRandom(seed)
    const work: Promise<void>[] = []
    for (let batch = 0; batch < 60; batch++) {
      for (let i = 0; i < 5; i++) {
        if (random(12) === 0) { work.push(frame.resetAdvancedCategories()); model = [...order.DEFAULT_ADVANCED_CATEGORIES] }
        else {
          const cat = order.CATEGORY_SELECTION_ORDER[random(order.CATEGORY_SELECTION_ORDER.length)]
          work.push(frame.toggleAdvancedCategory(cat))
          model = model.includes(cat) ? model.filter(value => value !== cat) : [...model, cat]
        }
      }
      frame = render()
      assert.deepEqual([...frame.advancedCategories], model)
    }
    await flush()
    assert.equal(writes.length, 1)
    for (let i = 0; i < work.length; i++) { assert.equal(writes.length, i + 1); writes[i].resolve(); await flush() }
    await Promise.all(work)
    assert.deepEqual(writes.at(-1)!.value, model)
  }
})

test('古い保存失敗で新しい振り分けを戻さず、最後の保存失敗時だけ保存済みの状態へ戻す', async () => {
  const pending: { value: GadgetCategory[]; resolve: () => void; reject: (error: Error) => void }[] = []
  const render = advancedState(value => new Promise<void>((resolve, reject) => pending.push({ value: [...value], resolve, reject })))
  const frame = render()
  const first = frame.toggleAdvancedCategory('Mouse').catch(() => {})
  const second = frame.toggleAdvancedCategory('Monitor')
  await flush()
  assert.equal(pending.length, 1)
  pending[0].reject(new Error('disk full'))
  await flush()
  assert.equal(pending.length, 2)
  assert.ok(render().advancedCategories.includes('Mouse'))
  assert.ok(render().advancedCategories.includes('Monitor'))
  pending[1].resolve()
  await Promise.all([first, second])
  const saved = [...render().advancedCategories]
  const third = render().toggleAdvancedCategory('Desk').catch(() => {})
  await flush()
  pending[2].reject(new Error('disk full'))
  await third
  assert.deepEqual([...render().advancedCategories], saved)
  const retry = render().resetAdvancedCategories()
  await flush()
  pending[3].resolve()
  await retry
  assert.deepEqual([...render().advancedCategories], [...order.DEFAULT_ADVANCED_CATEGORIES])
})
