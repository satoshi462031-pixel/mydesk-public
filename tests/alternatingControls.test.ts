import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { synchronizedTabOffset } from '../src/utils/collapsibleTabScroll'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'

function sourceOf(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}
function find(file: string, matches: (node: ts.Node) => boolean) {
  const source = sourceOf(file)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => { if (matches(node)) found = node; ts.forEachChild(node, visit) }
  visit(source)
  assert.ok(found, file)
  return found.getText(source)
}
function evaluate(code: string, bindings: Record<string, any>) {
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, {
    exports: {}, require: () => ({ jsx, jsxs: jsx }), useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }),
    useEffect: () => {},
    useState: (initial: unknown) => [initial, () => {}], useApp: () => ({ colors: {}, lang: 'ja', t: String }),
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon',
    styles: {}, ICONS: {}, hapticSelection: () => {}, reduceMotion: false,
    LayoutAnimation: { configureNext: () => {}, create: () => ({}), Types: {}, Properties: {} }, ...bindings,
  })
}
function callback(file: string, name: string, bindings: Record<string, any>) {
  const declaration = find(file, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name)
  return evaluate(declaration.slice(declaration.indexOf('=') + 1), bindings)
}
function component(file: string, name: string, bindings: Record<string, any> = {}) {
  return evaluate(find(file, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name).replace(/^export /, ''), bindings)
}
function componentSession(file: string, name: string, bindings: Record<string, any> = {}) {
  const slots: any[] = []
  let cursor = 0
  const render = component(file, name, {
    ...bindings,
    useRef: (current: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current }
      return slots[index]
    },
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (update: any) => { slots[index] = typeof update === 'function' ? update(slots[index]) : update }]
    },
  })
  return (props: any) => { cursor = 0; return render(props) }
}
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}
function pressAttribute(file: string, setter: string, bindings: Record<string, any>) {
  const attribute = find(file, (node) => ts.isJsxAttribute(node) && node.name.getText() === 'onPress'
    && !!node.initializer?.getText().includes(`${setter}(`))
  return evaluate(attribute.slice(attribute.indexOf('{') + 1, -1), bindings)
}

test('開閉ボタンは再描画前の連打も反映し、FAQは最後に押した項目だけ開く', () => {
  for (const [file, setter, initial, bindings] of [
    ['src/screens/PaywallScreen.tsx', 'setShowComparison', false, { showComparison: false }],
    ['src/components/molecules/PortConfigurationEditor.tsx', 'setManualOpen', null, { open: true, hasConfiguredAdvanced: true }],
    ['src/screens/SettingsScreen.tsx', 'setOpenFaq', null, { open: false, i: 2 }],
  ] as const) {
    let value: any = initial
    const press = pressAttribute(file, setter, { ...bindings, [setter]: (next: any) => { value = typeof next === 'function' ? next(value) : next } })
    for (let i = 0; i < 50; i++) {
      press(); press()
      assert.equal(value, setter === 'setManualOpen' ? true : initial, setter)
    }
  }
  let value: number | null = null
  const setOpenFaq = (next: any) => { value = typeof next === 'function' ? next(value) : next }
  const presses = [0, 1, 2].map(i => pressAttribute('src/screens/SettingsScreen.tsx', 'setOpenFaq', { i, open: false, setOpenFaq }))
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    for (let i = 0; i < 300; i++) {
      const next = random(3)
      const expected: number | null = value === next ? null : next
      presses[next]()
      assert.equal(value, expected)
    }
  }
})

test('PCの詳細スペックは連打で開閉でき、親からの変更後もその値から反転する', () => {
  let expanded = false
  const render = componentSession('src/components/molecules/PcSpecFields.tsx', 'PcSpecFields', {
    ToggleRow: 'ToggleRow', PcPartProductField: 'PcPartProductField',
  })
  const props = () => ({ expanded, onExpanded: (next: boolean) => { expanded = next }, colors: {}, lang: 'ja' })
  const press = () => nodes(render(props())).find(node => node.type === 'TouchableOpacity')!.props.onPress
  const toggle = press()
  toggle(); toggle()
  assert.equal(expanded, false)
  expanded = true
  const updated = press()
  updated(); assert.equal(expanded, false)
  updated(); assert.equal(expanded, true)
})

test('検索の横並びタブは再描画前に往復しても最後の種類へ戻る', () => {
  let scope = 'all'
  const change = callback('src/screens/DeskFeedScreen.tsx', 'changeScope', { scope, setScope: (next: string) => { scope = next } })
  for (let i = 0; i < 30; i++) {
    change('people'); assert.equal(scope, 'people')
    change('desks'); assert.equal(scope, 'desks')
    change('all'); assert.equal(scope, 'all')
  }
})

test('保存のデスク・ガジェットは交互連打を受け付け、直前の側からスクロール位置を引き継ぐ', () => {
  let scope = 'desks'
  const offsets = { current: { desks: 45, gadgets: 320 } }
  let request: any
  const change = callback('src/screens/BookmarkListScreen.tsx', 'changeScope', {
    scope, scopeRef: { current: scope }, scopeOffsetsRef: offsets, headerCollapseDistance: 180,
    scopeRequestIdRef: { current: 0 }, scrollY: { setValue: () => {} }, synchronizedTabOffset,
    setEffectiveScrollRequest: (next: any) => { request = next }, setScope: (next: string) => { scope = next },
  })
  change('gadgets')
  assert.equal(scope, 'gadgets')
  assert.equal(request.offset, 45)
  offsets.current.gadgets = 260
  change('desks')
  assert.equal(scope, 'desks')
  assert.equal(request.offset, 180)
  for (let i = 0; i < 30; i++) { change('gadgets'); change('desks'); assert.equal(scope, 'desks') }
})

test('見た・拍手したを同じ描画のまま往復しても選択が戻り、取得済みの一覧を消さない', () => {
  let scope = 'viewed'
  const original = [{ id: 'viewed-desk' }]
  let items = original
  let loading = false
  const change = callback('src/screens/ViewHistoryListScreen.tsx', 'changeScope', {
    scope, setScope: (next: string) => { scope = next },
    setItems: (next: typeof items) => { items = next }, setLoading: (next: boolean) => { loading = next },
  })
  for (let i = 0; i < 30; i++) { change('clapped'); change('viewed'); assert.equal(scope, 'viewed') }
  assert.equal(items, original)
  assert.equal(loading, false)
})

test('使用中・未使用も再描画前の往復を取りこぼさない', () => {
  let usageFilter = 'current'
  const attribute = find('src/screens/GadgetLibraryScreen.tsx', (node) => ts.isJsxAttribute(node)
    && node.name.getText() === 'onChangeUsage' && !!node.initializer?.getText().includes('setUsageFilter'))
  const change = evaluate(attribute.slice(attribute.indexOf('{') + 1, -1), {
    usageFilter, setUsageFilter: (next: string) => { usageFilter = next },
    swipeableRefs: { current: new Map() }, leaveSelectionMode: () => {},
  })
  for (let i = 0; i < 30; i++) { change('unused'); change('current'); assert.equal(usageFilter, 'current') }
})

for (const [file, setter, keyName, initial, other] of [
  ['src/components/organisms/GadgetBookmarkList.tsx', 'setBrand', 'key', 'brand-a', 'brand-b'],
  ['src/screens/DeskFeedScreen.tsx', 'setDraftPurpose', 'key', 'work', 'gaming'],
  ['src/screens/DeskFeedScreen.tsx', 'setDraftCategory', 'category', 'Monitor', 'Keyboard'],
  ['src/screens/GadgetDetailScreen.tsx', 'setCableType', 'value', 'USB_C', 'HDMI'],
]) {
  test(`${setter}: 別の選択肢から戻したら選択し、同じ選択肢の連打だけ解除する`, () => {
    let selected: string | null = initial
    const setterFn = (next: any) => { selected = typeof next === 'function' ? next(selected) : next }
    const bindings = { [setter]: setterFn, selected: true, cableType: initial, [keyName]: initial }
    const first = pressAttribute(file, setter, bindings)
    const second = pressAttribute(file, setter, { ...bindings, selected: false, [keyName]: other })
    for (let i = 0; i < 30; i++) { second(); first(); assert.equal(selected, initial) }
    first()
    assert.ok(selected === null || selected === '')
  })
}

test('個数の＋／−は再描画前でも直前の値から計算し、上限・下限を越えない', () => {
  let value = 5
  const render = component('src/components/atoms/NumberStepper.tsx', 'NumberStepper')
  const tree = render({ value, min: 0, max: 10, accessibilityLabel: 'Count', onChange: (next: number) => { value = next } })
  const [minus, plus] = nodes(tree).filter((node) => node.type === 'TouchableOpacity')
  for (let i = 0; i < 30; i++) {
    plus.props.onPress(); assert.equal(value, 6)
    minus.props.onPress(); assert.equal(value, 5)
  }
  for (let i = 0; i < 20; i++) plus.props.onPress()
  assert.equal(value, 10)
  for (let i = 0; i < 20; i++) minus.props.onPress()
  assert.equal(value, 0)
})

test('再生速度の＋／−とプリセットを混ぜて押しても直前の速度から計算する', () => {
  let value = 1
  const render = component('src/components/molecules/PlaybackSpeedControl.tsx', 'PlaybackSpeedControl', {
    PanResponder: { create: (panHandlers: unknown) => ({ panHandlers }) }, THUMB_SIZE: 20,
    MIN_PLAYBACK_SPEED: 0.25, MAX_PLAYBACK_SPEED: 4, PLAYBACK_SPEED_STEP: 0.25, PLAYBACK_SPEEDS: [0.5, 1, 2],
    clampSpeed: (next: number) => Math.max(0.25, Math.min(4, next)),
  })
  const tree = render({ value, onChange: (next: number) => { value = next } })
  const minus = nodes(tree).find((node) => node.props.accessibilityLabel === '再生速度を下げる')!
  const plus = nodes(tree).find((node) => node.props.accessibilityLabel === '再生速度を上げる')!
  for (let i = 0; i < 30; i++) {
    plus.props.onPress(); assert.equal(value, 1.25)
    minus.props.onPress(); assert.equal(value, 1)
  }
  nodes(tree).find((node) => node.props.accessibilityLabel === '2倍')!.props.onPress()
  minus.props.onPress()
  assert.equal(value, 1.75)
  for (let i = 0; i < 30; i++) plus.props.onPress()
  assert.equal(value, 4)
})

test('充電先の機材を続けて選んでも前の選択を落とさず、解除と最大数も守る', () => {
  let value: string[] = []
  const render = component('src/components/organisms/GadgetTargetPickers.tsx', 'WirelessGadgetPicker', {
    WIRELESS_CAPABLE_CATS: ['Smartphone'], categoryIconColor: () => '#000000', statusTextColor: () => '#000000',
    CategoryIcon: 'CategoryIcon', localizedGadgetName: (gadget: any) => gadget.id,
  })
  const tree = render({ value, maxCount: 2, colors: {}, lang: 'ja',
    allGadgets: ['A', 'B', 'C'].map((id) => ({ id, category: 'Smartphone' })),
    onChange: (next: string[]) => { value = next },
  })
  const button = (id: string) => nodes(tree).find((node) => node.props.accessibilityLabel === id)!.props.onPress()
  button('A'); button('B'); button('C')
  assert.deepEqual(Array.from(value), ['A', 'B'])
  button('A'); button('C')
  assert.deepEqual(Array.from(value), ['B', 'C'])
  button('B'); button('C')
  assert.deepEqual(Array.from(value), [])
})

test('端子のチェックを交互に押しても、各項目を操作した回数だけ切り替える', () => {
  let state: Record<string, boolean> = { a: false, b: false }
  const render = component('src/components/molecules/PortConfigurationEditor.tsx', 'PortConfigurationEditor', {
    portFormFieldLabel: (field: any) => field.key, portIconColor: () => '#000000', PORT_ICONS: {},
  })
  const tree = render({ fields: ['a', 'b'].map((key) => ({ key, kind: 'toggle', portType: 'Power' })),
    state, colors: {}, lang: 'ja', title: 'Ports', onChange: (key: string, next: boolean) => { state = { ...state, [key]: next } },
  })
  const [first, second] = nodes(tree).filter((node) => node.props.accessibilityRole === 'checkbox')
  first.props.onPress(); second.props.onPress(); first.props.onPress()
  assert.deepEqual(state, { a: false, b: true })
  second.props.onPress()
  assert.deepEqual(state, { a: false, b: false })
})

function historyLoadBindings(read: (target: string) => Promise<any[]>) {
  return {
    user: { id: 'me' }, historyLimit: 100, VIEW_HISTORY_STORAGE_LIMIT: 1000, HISTORY_PAGE_SIZE: 40,
    reloadingRef: { current: false }, entriesRef: { current: [] }, cursorRef: { current: 0 }, loadedCountRef: { current: 40 },
    setLoadingMore() {}, setMoreError() {}, setHistoryCount() {}, setHasMore() {},
    loadViewHistory: async () => (await read('viewed')).map((entry) => ({ deskId: entry.id, viewedAt: '2026-10-19' })),
    getClappedDeskEntries: async () => (await read('clapped')).map((entry) => ({ deskId: entry.id, clappedAt: '2026-10-19' })),
    fetchPage: async (entries: any[]) => ({ items: entries.map((entry) => ({ id: entry.deskId })), cursor: entries.length }),
  }
}

test('履歴を切り替えた後に古い取得結果が届いても、選択中の一覧・エラーを上書きしない', async () => {
  const file = 'src/screens/ViewHistoryListScreen.tsx'
  let items: any[] = [{ id: 'original' }]
  let loading = false
  let error = false
  let resolveOld!: (items: any[]) => void
  let rejectOld!: (error: Error) => void
  let resolveNew!: (items: any[]) => void
  const old = new Promise<any[]>((resolve, reject) => { resolveOld = resolve; rejectOld = reject })
  const next = new Promise<any[]>((resolve) => { resolveNew = resolve })
  const bindings = {
    scope: 'clapped', loadRequestRef: { current: 0 }, loadedScopeRef: { current: 'viewed' },
    setItems: (value: any[]) => { items = value }, setLoading: (value: boolean) => { loading = value },
    setLoadError: (value: boolean) => { error = value }, setRefreshing: () => {},
    ...historyLoadBindings((target) => target === 'viewed' ? old : next),
  }
  const load = callback(file, 'load', bindings)
  const previousRequest = load('viewed', 'refresh')
  const reset = find(file, (node) => ts.isCallExpression(node) && node.expression.getText() === 'useLayoutEffect'
    && node.getText().includes('loadRequestRef.current++'))
  evaluate(`() => { ${reset} }`, { ...bindings, useLayoutEffect: (run: () => void) => run() })()
  const newRequest = load('clapped', 'initial')
  assert.equal(loading, true)
  assert.deepEqual(Array.from(items), [])
  resolveNew([{ id: 'clapped-desk' }])
  await newRequest
  assert.equal(loading, false)
  assert.equal(items[0].id, 'clapped-desk')
  rejectOld(new Error('old request failed'))
  await previousRequest
  assert.equal(error, false)
  assert.equal(items[0].id, 'clapped-desk')
  resolveOld([])
})

for (const [file, name] of [
  ['src/components/atoms/SegmentedControl.tsx', 'SegmentedControl'],
  ['src/components/molecules/SearchScopeTabs.tsx', 'SearchScopeTabs'],
  ['src/screens/SettingsScreen.tsx', 'SettingsChoiceList'],
]) {
  test(`${name}: 元の選択肢へ戻るタップも親へ伝える`, () => {
    const keys = name === 'SearchScopeTabs' ? ['all', 'desks', 'people'] : ['first', 'second', 'third']
    let value = keys[0]
    let feedback = 0
    const render = component(file, name, {
      SegmentHighlight: 'SegmentHighlight', TabUnderline: 'TabUnderline',
      SCOPES: keys, UNDERLINE_RATIO: 0.56, StyleSheet: { hairlineWidth: 1 },
      hapticSelection: () => { feedback++ },
    })
    const tree = render({ value, colors: {}, lang: 'ja',
      options: keys.map((key) => ({ key, value: key, label: key })), onChange: (next: string) => { value = next },
    })
    const buttons = nodes(tree).filter((node) => node.type === 'TouchableOpacity')
    for (let i = 0; i < 30; i++) {
      buttons[1].props.onPress(); assert.equal(value, keys[1])
      buttons[2].props.onPress(); assert.equal(value, keys[2])
      buttons[0].props.onPress(); assert.equal(value, keys[0])
    }
    assert.equal(feedback, 90, '戻る操作も選択変更として振動する')
    buttons[0].props.onPress()
    assert.equal(feedback, 90, '同じ選択肢の押し直しでは振動しない')
  })
}

test('選択・絞り込みはランダムな選択と同じ選択肢の連打でも操作順に一致する', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    for (const [file, setter, keyName, empty] of [
      ['src/components/organisms/GadgetBookmarkList.tsx', 'setBrand', 'key', null],
      ['src/screens/DeskFeedScreen.tsx', 'setDraftPurpose', 'key', null],
      ['src/screens/DeskFeedScreen.tsx', 'setDraftCategory', 'category', null],
      ['src/screens/GadgetDetailScreen.tsx', 'setCableType', 'value', ''],
    ] as const) {
      let value: string | null = empty
      let expected: string | null = empty
      const options = ['A', 'B', 'C', 'D']
      const handlers = options.map((key) => pressAttribute(file, setter, {
        [setter]: (update: any) => { value = typeof update === 'function' ? update(value) : update },
        selected: false, cableType: '', [keyName]: key,
      }))
      for (let i = 0; i < 500; i++) {
        const index = random(options.length)
        expected = expected === options[index] ? empty : options[index]
        handlers[index]()
        assert.equal(value, expected, `${setter}: seed=${seed}, step=${i}`)
      }
    }
    for (const [file, name] of [
      ['src/components/atoms/SegmentedControl.tsx', 'SegmentedControl'],
      ['src/components/molecules/SearchScopeTabs.tsx', 'SearchScopeTabs'],
      ['src/screens/SettingsScreen.tsx', 'SettingsChoiceList'],
    ]) {
      const keys = name === 'SearchScopeTabs' ? ['all', 'desks', 'people'] : ['first', 'second', 'third']
      let value = keys[0], expected = value, feedback = 0, expectedFeedback = 0
      const render = componentSession(file, name, {
        SegmentHighlight: 'SegmentHighlight', TabUnderline: 'TabUnderline', SCOPES: keys, UNDERLINE_RATIO: 0.56,
        StyleSheet: { hairlineWidth: 1 }, hapticSelection: () => { feedback++ },
      })
      const paint = () => nodes(render({ value, colors: {}, lang: 'ja',
        options: keys.map((key) => ({ key, value: key, label: key })), onChange: (next: string) => { value = next },
      })).filter((node) => node.type === 'TouchableOpacity')
      let buttons = paint()
      for (let i = 0; i < 500; i++) {
        const index = random(keys.length)
        if (expected !== keys[index]) expectedFeedback++
        expected = keys[index]
        buttons[index].props.onPress()
        assert.equal(value, expected, `${name}: seed=${seed}, step=${i}`)
        assert.equal(feedback, expectedFeedback)
        if (random(4) === 0) buttons = paint()
      }
    }
  }
})

test('個数・再生速度はランダム連打、プリセット、ドラッグ中断、外部リセットでも値を保つ', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    let count = 5, expectedCount = 5
    const countSession = componentSession('src/components/atoms/NumberStepper.tsx', 'NumberStepper')
    const paintCount = () => nodes(countSession({ value: count, min: 0, max: 10,
      accessibilityLabel: 'Count', onChange: (next: number) => { count = next },
    })).filter((node) => node.type === 'TouchableOpacity')
    let countButtons = paintCount()
    for (let i = 0; i < 1000; i++) {
      if (random(10) === 0) {
        count = expectedCount = random(11)
        countButtons = paintCount()
      }
      const index = random(2)
      if (!countButtons[index].props.disabled) {
        expectedCount = Math.max(0, Math.min(10, expectedCount + (index ? 1 : -1)))
        countButtons[index].props.onPress()
      }
      assert.equal(count, expectedCount, `count: seed=${seed}, step=${i}`)
      if (random(4) === 0) countButtons = paintCount()
    }
    let speed = 1, expectedSpeed = 1
    const presets = [0.5, 1, 2]
    const speedSession = componentSession('src/components/molecules/PlaybackSpeedControl.tsx', 'PlaybackSpeedControl', {
      PanResponder: { create: (panHandlers: unknown) => ({ panHandlers }) }, THUMB_SIZE: 20,
      MIN_PLAYBACK_SPEED: 0.25, MAX_PLAYBACK_SPEED: 4, PLAYBACK_SPEED_STEP: 0.25, PLAYBACK_SPEEDS: presets,
      clampSpeed: (next: number) => Math.max(0.25, Math.min(4, Math.round(next * 4) / 4)),
    })
    const paintSpeed = () => speedSession({ value: speed, onChange: (next: number) => { speed = next } })
    let tree = paintSpeed()
    nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props.onLayout({ nativeEvent: { layout: { width: 100 } } })
    tree = paintSpeed()
    for (let i = 0; i < 1000; i++) {
      const action = random(6)
      if (action < 2) {
        const button = nodes(tree).find((node) => node.props.accessibilityLabel === (action ? '再生速度を上げる' : '再生速度を下げる'))!
        if (!button.props.disabled) {
          expectedSpeed = Math.max(0.25, Math.min(4, expectedSpeed + (action ? 0.25 : -0.25)))
          button.props.onPress()
        }
      } else if (action === 2) {
        const index = random(presets.length)
        nodes(tree).filter((node) => node.props.accessibilityRole === 'radio')[index].props.onPress()
        expectedSpeed = presets[index]
      } else if (action === 3 || action === 4) {
        const slider = nodes(tree).find((node) => node.props.accessibilityRole === 'adjustable')!.props
        const x = random(121) - 10
        slider.onPanResponderGrant({ nativeEvent: { locationX: x } })
        if (random(2)) tree = paintSpeed()
        if (action === 4) slider.onPanResponderTerminate()
        else {
          const dx = random(81) - 40
          slider.onPanResponderRelease({}, { dx })
          const ratio = Math.max(0, Math.min(1, (x + dx - 10) / 80))
          expectedSpeed = Math.round((0.25 + ratio * 3.75) * 4) / 4
        }
      } else {
        speed = expectedSpeed = (random(16) + 1) / 4
        tree = paintSpeed()
      }
      assert.equal(speed, expectedSpeed, `speed: seed=${seed}, step=${i}`)
      if (random(4) === 0) tree = paintSpeed()
    }
  }
})

test('充電先と端子の複数選択はランダム連打と再描画でも他の選択を失わない', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const ids = ['A', 'B', 'C', 'D', 'E']
    let selected: string[] = []
    const expected = new Set<string>()
    const wireless = componentSession('src/components/organisms/GadgetTargetPickers.tsx', 'WirelessGadgetPicker', {
      WIRELESS_CAPABLE_CATS: ['Smartphone'], categoryIconColor: () => '#000000', statusTextColor: () => '#000000',
      CategoryIcon: 'CategoryIcon', localizedGadgetName: (gadget: any) => gadget.id,
    })
    const paint = () => nodes(wireless({ value: selected, maxCount: 3, colors: {}, lang: 'ja',
      allGadgets: ids.map((id) => ({ id, category: 'Smartphone' })), onChange: (next: string[]) => { selected = next },
    })).filter((node) => node.props.accessibilityRole === 'checkbox')
    let buttons = paint()
    for (let i = 0; i < 1000; i++) {
      const index = random(ids.length)
      if (!buttons[index].props.disabled) {
        const id = ids[index]
        if (expected.has(id)) expected.delete(id)
        else if (expected.size < 3) expected.add(id)
        buttons[index].props.onPress()
      }
      assert.deepEqual([...selected].sort(), [...expected].sort(), `wireless: seed=${seed}, step=${i}`)
      if (random(4) === 0) buttons = paint()
    }
    let ports: Record<string, boolean> = Object.fromEntries(ids.map((id) => [id, false]))
    const expectedPorts = { ...ports }
    const portSession = componentSession('src/components/molecules/PortConfigurationEditor.tsx', 'PortConfigurationEditor', {
      portFormFieldLabel: (field: any) => field.key, portIconColor: () => '#000000', PORT_ICONS: {},
    })
    const paintPorts = () => nodes(portSession({ fields: ids.map((key) => ({ key, kind: 'toggle', portType: 'Power' })),
      state: ports, colors: {}, lang: 'ja', title: 'Ports',
      onChange: (key: string, value: boolean) => { ports = { ...ports, [key]: value } },
    })).filter((node) => node.props.accessibilityRole === 'checkbox')
    let portButtons = paintPorts()
    for (let i = 0; i < 1000; i++) {
      const index = random(ids.length)
      expectedPorts[ids[index]] = !expectedPorts[ids[index]]
      portButtons[index].props.onPress()
      assert.deepEqual(ports, expectedPorts, `ports: seed=${seed}, step=${i}`)
      if (random(4) === 0) portButtons = paintPorts()
    }
  }
})

test('保存の切り替えとスクロールをランダムに混ぜても最後の種類と収納位置を保つ', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const keys = ['desks', 'gadgets'] as const
    let scope: typeof keys[number] = 'desks'
    let expectedScope: typeof keys[number] = 'desks'
    const offsets = { current: { desks: 0, gadgets: 0 } }
    const expectedOffsets = { ...offsets.current }
    let request: { id: number; offset: number } | undefined
    let expectedRequest = 0
    const scopeRef: { current: typeof keys[number] } = { current: scope }
    const requestRef = { current: 0 }
    const paint = () => {
      scopeRef.current = scope
      return callback('src/screens/BookmarkListScreen.tsx', 'changeScope', {
        scope, scopeRef, scopeOffsetsRef: offsets, headerCollapseDistance: 180, scopeRequestIdRef: requestRef,
        scrollY: { setValue: () => {} }, synchronizedTabOffset,
        setEffectiveScrollRequest: (next: typeof request) => { request = next },
        setScope: (next: typeof scope) => { scope = next },
      })
    }
    let change = paint()
    for (let i = 0; i < 500; i++) {
      if (random(3) === 0) {
        const y = random(600)
        offsets.current[scope] = expectedOffsets[expectedScope] = y
      }
      const next = keys[random(keys.length)]
      const switched = next !== expectedScope
      if (switched) {
        expectedOffsets[next] = synchronizedTabOffset(expectedOffsets[expectedScope], expectedOffsets[next], 180)
        expectedScope = next
        expectedRequest++
      }
      change(next)
      assert.equal(scope, expectedScope, `seed=${seed}, step=${i}`)
      assert.deepEqual(offsets.current, expectedOffsets)
      assert.equal(requestRef.current, expectedRequest)
      if (request && switched) assert.equal(request.offset, expectedOffsets[expectedScope])
      if (random(5) === 0) change = paint()
    }
  }
})

test('履歴のランダム切り替えは、順不同の取得成功・失敗と再描画でも最新の一覧を保つ', async () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const keys = ['viewed', 'clapped']
    let scope = keys[0], renderedScope = scope
    let items: any[] = [{ id: 'initial' }], expectedItems = items
    let loading = false, expectedLoading = false, error = false, expectedError = false
    type Request = { scope: string; id: number; work?: Promise<void>; finish: (failed: boolean) => Promise<void> }
    const pending: Request[] = []
    let latest: Request | undefined
    let id = 0
    const bindings = {
      loadRequestRef: { current: 0 }, loadedScopeRef: { current: scope },
      setItems: (next: any[]) => { items = next }, setLoading: (next: boolean) => { loading = next },
      setLoadError: (next: boolean) => { error = next }, setRefreshing: () => {},
      ...historyLoadBindings((target: string) => new Promise<any[]>((resolve, reject) => {
        const request: Request = { scope: target, id: ++id, finish: async (failed) => {
          if (failed) reject(new Error('random network failure'))
          else resolve([{ id: `${target}-${request.id}` }])
          await request.work
        } }
        pending.push(request)
        latest = request
      })),
    }
    const file = 'src/screens/ViewHistoryListScreen.tsx'
    const load = callback(file, 'load', bindings)
    const change = callback(file, 'changeScope', { setScope: (next: string) => { scope = next } })
    const reset = find(file, (node) => ts.isCallExpression(node) && node.expression.getText() === 'useLayoutEffect'
      && node.getText().includes('loadRequestRef.current++'))
    const commit = () => {
      if (scope === renderedScope) return
      renderedScope = scope
      evaluate(`() => { ${reset} }`, { ...bindings, scope, useLayoutEffect: (run: () => void) => run() })()
      expectedItems = []; expectedLoading = true; expectedError = false
      const work = load(scope, 'initial')
      latest!.work = work
    }
    for (let i = 0; i < 300; i++) {
      change(keys[random(keys.length)])
      if (random(3) === 0) commit()
      if (pending.length && random(2) === 0) {
        const request = pending.splice(random(pending.length), 1)[0]
        const failed = random(4) === 0
        if (request === latest) {
          expectedLoading = false; expectedError = failed
          if (!failed) expectedItems = [{ id: `${request.scope}-${request.id}` }]
        }
        await request.finish(failed)
      }
      assert.deepEqual(Array.from(items), expectedItems, `seed=${seed}, step=${i}`)
      assert.equal(loading, expectedLoading)
      assert.equal(error, expectedError)
    }
    commit()
    while (pending.length) {
      const request = pending.splice(random(pending.length), 1)[0]
      if (request === latest) { expectedItems = [{ id: `${request.scope}-${request.id}` }]; expectedLoading = false; expectedError = false }
      await request.finish(false)
    }
    assert.deepEqual(Array.from(items), expectedItems)
    assert.equal(loading, expectedLoading)
    assert.equal(error, expectedError)
  }
})
