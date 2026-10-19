import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { gadgetFromProduct } from '../src/utils/gadgetFromProduct'
import { DESK_CATEGORY_ICONS } from '../src/constants/deskCategoryIcons'
import { setDeskGadgetUsage, hasCurrentDeskUsageAfterEdit } from '../src/utils/deskGadgetUsage'
import { buildTemplateItemGadget } from '../src/services/templateService'
import { applyProductToGadget } from '../src/utils/productFill'
import { formatStoredDate, parseDateInput } from '../src/utils/dateFormat'
import { trimAndTruncate, trimInvisible } from '../src/utils/truncateText'
import { GADGET_NAME_MAX_LENGTH } from '../src/constants/textLimits'
import { assignOwnedGadgetsToTemplateItems, ownedGadgetCategoriesNeedingSlots } from '../src/utils/templateOwnedGadgetSelection'
import type { Gadget } from '../src/types'

function callback(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Missing callback ${name}`)
  const code = ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return runInNewContext(code, bindings) as (...args: any[]) => any
}

test('機材の追加は最初の描画からジャンル一覧を出し、iOSでも選択後すぐ詳細設定へ進む', () => {
  const file = 'src/screens/AddGadgetScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const screen = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'AddGadgetScreen')
  assert.ok(screen)
  const code = ts.transpileModule(`(${screen.getText(source).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const nodes = (value: any): any[] => {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (!value || typeof value !== 'object' || !value.props) return []
    return [value, ...nodes(value.props.children)]
  }

  for (const browseEnabled of [false, true]) {
    const searches: boolean[] = []
    const navigations: any[] = []
    const timers: unknown[] = []
    const componentNames = ['SafeAreaView', 'KeyboardAvoidingView', 'CategorySectionPicker', 'SearchField',
      'ScrollView', 'Modal', 'View', 'Text', 'TouchableOpacity', 'AppIcon', 'CategoryIcon', 'FlatList',
      'ActivityIndicator', 'Image', 'BrandChip', 'Button', 'MissingIntroductionDateSheet', 'BottomSheetModal', 'HeaderIconButton', 'CoachScope']
    const render = runInNewContext(code, {
      exports: {}, require: () => ({ jsx, jsxs: jsx, Fragment: 'Fragment' }),
      ...Object.fromEntries(componentNames.map((name) => [name, name])),
      styles: {}, ICONS: {}, RESULT_LIMIT: 30, PRODUCT_BROWSE_ENABLED: browseEnabled, Platform: { OS: 'ios' },
      useHeaderHeight: () => 0, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
      useApp: () => ({ colors: {}, lang: 'ja', t: (key: string) => key }),
      useGadgets: () => ({ gadgets: [], add: () => assert.fail('保存前に登録している') }),
      usePlans: () => ({ plans: [], updateWith: () => {} }), usePlanOpenedAt: () => ({}),
      sortPlansLikeMyDesk: () => [], useMemo: (fn: () => unknown) => fn(),
      useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useRef: (current: unknown) => ({ current }), useEffect: () => {}, useLayoutEffect: () => {},
      useCallback: (fn: unknown) => fn, gadgetFromProduct, uuidv4: () => 'draft',
      useCoachMarks: () => ({ target: () => undefined, open: async () => {}, overlay: null }), COACH_SCREEN: '__screen', ADD_GADGET_COACH: [],
      setTimeout: (fn: unknown) => { timers.push(fn) },
      useProductSuggestionsState: (_category: unknown, _query: unknown, _lang: unknown, enabled: boolean) => {
        searches.push(enabled)
        return { suggestions: [], loading: false, error: false }
      },
    }) as (props: any) => any
    const tree = render({
      route: { params: { showCategoryPicker: true } },
      navigation: { isFocused: () => true, navigate: (...args: unknown[]) => navigations.push(args) },
    })
    const rendered = nodes(tree)
    const picker = rendered.find((node) => node.type === 'CategorySectionPicker')
    assert.ok(picker)
    assert.equal(rendered.some((node) => node.type === 'SearchField' || node.type === 'FlatList'), false)
    assert.equal(rendered.some((node) => node.type === 'Modal' && node.props.visible), false)
    assert.deepEqual(searches, [false])
    picker.props.onSelect('Monitor')
    assert.equal(navigations.length, 1)
    assert.equal(navigations[0][0], 'GadgetDetail')
    assert.equal(navigations[0][1].draftGadget.category, 'Monitor')
    assert.equal(timers.length, 0)
    const custom = { id: 'stand', name: '台', icon: 'desk-monitor-shelf', color: '#159D67' }
    picker.props.onSelectCustom(custom)
    assert.equal(navigations.length, 1)
    const fresh = render({
      route: { params: { showCategoryPicker: true } },
      navigation: { isFocused: () => true, navigate: (...args: unknown[]) => navigations.push(args) },
    })
    nodes(fresh).find((node) => node.type === 'CategorySectionPicker')!.props.onSelectCustom(custom)
    assert.equal(navigations[1][1].draftGadget.customCategory, custom)
    assert.equal(timers.length, 0)
  }
})

test('ジャンル選択はモーダルを閉じてから詳細設定を開き、保存前の機材を登録しない', () => {
  for (const purpose of [{ kind: 'filter' }, { kind: 'assign', name: 'ノートPC台' }]) {
    const state = { pending: null as any, draftId: null as any, picker: purpose as unknown, calls: [] as any[] }
    const pendingDetailRef = { current: state.pending }
    const draftRegistrationIdRef = { current: state.draftId }
    const navigation = { isFocused: () => true, navigate: (...args: unknown[]) => state.calls.push(args) }
    const open = callback('src/screens/AddGadgetScreen.tsx', 'openPendingDetail', { pendingDetailRef, draftRegistrationIdRef, navigation, planId: 'desk', leavingRef: { current: false } })
    const prepareDraft = callback('src/screens/AddGadgetScreen.tsx', 'prepareDraft', {
      gadgetFromProduct, uuidv4: () => 'draft', trimmedQuery: '', deskGadgets: [], pendingDetailRef,
    })
    const choose = callback('src/screens/AddGadgetScreen.tsx', 'chooseCategory', {
      pickerPurpose: purpose, pickerPurposeRef: { current: purpose }, directCategorySelection: false, setPickerPurpose: (value: unknown) => { state.picker = value },
      detailOpeningRef: { current: false }, leavingRef: { current: false }, savingRef: { current: false }, navigation,
      prepareDraft, openPendingDetail: open, Platform: { OS: 'ios' },
    })
    const custom = { id: 'stand', name: 'ノートPCスタンド', icon: 'desk-laptop-stand', color: '#962AB0' }
    choose('Other', custom)
    assert.equal(state.picker, null)
    assert.equal(state.calls.length, 0)
    // 数え先は詳細設定を開いた時点で移す（開く前は前のまま）
    assert.equal(draftRegistrationIdRef.current, null)
    open()
    assert.equal(state.calls.length, 1)
    assert.equal(draftRegistrationIdRef.current, 'draft')
    const [screen, params] = state.calls[0]
    assert.equal(screen, 'GadgetDetail')
    assert.equal(params.planId, 'desk')
    assert.equal(params.draftGadget.customCategory, custom)
    assert.equal(params.draftGadget.name, purpose.kind === 'assign' ? purpose.name : '')
    assert.ok(params.draftGadget.ports)
    open()
    assert.equal(state.calls.length, 1)
  }
})

test('デスク作成で標準・自作ジャンルを足したら、その機材の設定を開く対象にする', () => {
  for (const custom of [undefined, { id: 'stand', name: 'モニター台', icon: 'desk-monitor-shelf', color: '#159D67' }]) {
    let items: any[] = []
    let pending: any = null
    const add = callback('src/screens/TemplateDetailScreen.tsx', custom ? 'addCustomCategory' : 'addCategory', {
      addedItemKeys: { current: new Set() },
      setCatPickerOpen: () => {}, setExtraItems: (fn: (items: any[]) => any[]) => { items = fn(items) },
      t: () => 'モニター', template: undefined, defaultConnTypeForSlot: () => 'wired',
      setNewItemDetail: (item: unknown) => { pending = item },
    })
    add(custom ?? 'Monitor')
    assert.equal(items.length, 1)
    assert.equal(pending, items[0])
    assert.equal(pending.category, custom ? 'Other' : 'Monitor')
    assert.equal(pending.custom, custom)
  }
})

test('機材の編集を開くだけでは登録せず、行の入力を詳細画面の下書きへ渡す', async () => {
  for (const name of ['', 'My Monitor']) {
    const item = { key: 'extra-monitor', category: 'Monitor', name: 'モニター', source: 'extra' }
    const navigations: any[] = []
    const drafts: Record<string, string> = {}
    const open = callback('src/screens/TemplateDetailScreen.tsx', 'openItemDetail', {
      navigation: { isFocused: () => true, push: (...args: unknown[]) => navigations.push(args) },
      draftCreatingRef: { current: false }, createInFlightRef: { current: false }, existingDetailGadgetId: () => undefined,
      productNames: { [item.key]: name }, productPrices: { [item.key]: '12345' },
      productDates: { [item.key]: '2026/10/01' }, productPicks: {},
      trimInvisible, parsePriceToJpy: Number, parseDateInput, lang: 'ja', template: {}, items: [item],
      specFor: () => ({}), registerAsOwned: true, buildTemplateItemGadget,
      addGadgets: () => assert.fail('編集を開くだけで機材を登録している'),
      trackTemplateDraftGadget: async () => {},
      setDraftGadgets: (update: (prev: Record<string, string>) => Record<string, string>) => Object.assign(drafts, update(drafts)),
      analytics: { error: () => assert.fail('編集を開けなかった') }, showMessage: () => assert.fail('編集を開けなかった'),
    })
    await open(item)
    assert.equal(navigations.length, 1)
    const [screen, params] = navigations[0]
    assert.equal(screen, 'GadgetDetail')
    assert.equal(params.draftGadget.id, drafts[item.key])
    assert.equal(params.draftGadget.name, name || item.name)
    assert.equal(params.draftGadget.isPlaceholder, name ? undefined : true)
    assert.equal(params.draftGadget.price, 12345)
    assert.equal(params.draftGadget.purchasedAt, '2026-10-01')
  }
})

function templateExpression(kind: 'sync' | 'row', bindings: Record<string, unknown>) {
  const file = 'src/screens/TemplateDetailScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (kind === 'sync' && node.expression.getText(source) === 'useEffect'
        && node.arguments[0].getText(source).includes('syncedDraftProductsRef')) expression = node.arguments[0]
      if (kind === 'row' && node.expression.getText(source) === 'items.map' && ts.isJsxExpression(node.parent)) {
        expression = node.arguments[0]
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Missing template ${kind}`)
  const code = ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }), ...bindings }) as (...args: any[]) => any
}

test('詳細で保存した商品名・金額・導入日を機材の欄へ反映し、再描画で手入力を戻さない', () => {
  const gadget = { ...gadgetFromProduct({ id: 'draft', name: 'My Monitor', category: 'Monitor', now: '' }),
    price: 0, purchasedAt: '2026-10-01' }
  const state = { names: {} as Record<string, string>, prices: {} as Record<string, string>, dates: {} as Record<string, string> }
  const bindings = {
    liveDraftGadgets: { monitor: 'draft' }, gadgets: [gadget] as Gadget[], syncedDraftProductsRef: { current: new Map() },
    fmtPriceInput: String, formatStoredDate, lang: 'ja',
    setProductNames: (update: (prev: Record<string, string>) => Record<string, string>) => { state.names = update(state.names) },
    setProductPrices: (update: (prev: Record<string, string>) => Record<string, string>) => { state.prices = update(state.prices) },
    setProductDates: (update: (prev: Record<string, string>) => Record<string, string>) => { state.dates = update(state.dates) },
    setProductPicks: (update: (prev: Record<string, unknown>) => Record<string, unknown>) => update({}),
  }
  const sync = templateExpression('sync', bindings)
  sync()
  assert.equal(state.names.monitor, 'My Monitor')
  assert.equal(state.prices.monitor, '0')
  assert.equal(state.dates.monitor, '2026/10/01')
  state.names.monitor = 'Edited in gear step'
  sync()
  assert.equal(state.names.monitor, 'Edited in gear step')
  bindings.gadgets[0] = { ...gadget, name: 'Changed in detail', price: undefined, purchasedAt: undefined }
  sync()
  assert.equal(state.names.monitor, 'Changed in detail')
  assert.equal(state.prices.monitor, '')
  assert.equal(state.dates.monitor, '')
})

test('詳細で保存した機材も選択表示に置き換えず、3つの入力欄を表示する', () => {
  const gadget = gadgetFromProduct({ id: 'draft', name: 'My Monitor', category: 'Monitor', now: '' })
  const components = ['AdditionMotion', 'RemovableTemplateItem', 'SwipeableRow', 'View', 'Text', 'TouchableOpacity', 'AppIcon', 'CategoryIcon',
    'IconCircleButton', 'ProductNameField', 'TextField', 'DateField', 'CoachAnchor']
  const row = templateExpression('row', {
    ...Object.fromEntries(components.map((name) => [name, name])),
    addedItemKeys: { current: new Set() }, focused: true, catPickerOpen: false, newItemDetail: null, removingKeys: new Set(),
    styles: {}, C: { accent: '#123456' }, ICONS: {}, lang: 'ja', isDark: false, PRODUCT_BROWSE_ENABLED: false,
    categoryBaseColor: () => '#123456', categoryIconColor: () => '#123456',
    gadgets: [gadget], ownedAssignments: {}, liveDraftGadgets: { monitor: 'draft' },
    items: [{}], nameFieldKeys: ['monitor'], SWIPEABLE_ROW_PROPS: {}, SWIPE_OPEN_THRESHOLD: 40,
    productNames: { monitor: 'My Monitor' }, productPrices: { monitor: '10000' }, productDates: { monitor: '2026/10/01' },
    itemProductName: () => 'My Monitor', itemProductPrice: () => '10000', itemProductDate: () => '2026/10/01',
    maxIntroductionDate: new Date(), isReferencePrice: () => false, copySource: undefined,
  })
  const nodes = (value: any): any[] => {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (!value || typeof value !== 'object' || !value.props) return []
    return [value, ...nodes(value.props.children)]
  }
  const removal = row({ key: 'monitor', category: 'Monitor', name: 'モニター' }, 0).props.children
  const rendered = nodes(removal.props.children(() => {}))
  assert.equal(rendered.find((node) => node.type === 'ProductNameField')?.props.value, 'My Monitor')
  assert.equal(rendered.find((node) => node.type === 'TextField')?.props.value, '10000')
  assert.equal(rendered.find((node) => node.type === 'DateField')?.props.value, '2026/10/01')
  assert.equal(rendered.some((node) => node.props.children === '解除'), false)
})

test('登録済み機材を入れても枠と商品名・金額・導入日の入力欄を残す', () => {
  const gadget = gadgetFromProduct({ id: 'owned', name: 'My Monitor', category: 'Monitor', now: '' })
  const components = ['AdditionMotion', 'RemovableTemplateItem', 'SwipeableRow', 'View', 'Text', 'TouchableOpacity', 'AppIcon', 'CategoryIcon',
    'IconCircleButton', 'ProductNameField', 'TextField', 'DateField', 'CoachAnchor']
  const row = templateExpression('row', {
    ...Object.fromEntries(components.map((name) => [name, name])),
    addedItemKeys: { current: new Set() }, focused: true, catPickerOpen: false, newItemDetail: null, removingKeys: new Set(),
    styles: {}, C: { accent: '#123456' }, ICONS: {}, lang: 'ja', isDark: false, PRODUCT_BROWSE_ENABLED: false,
    categoryIconColor: () => '#123456', localizedGadgetName: (entry: Gadget) => entry.name,
    gadgets: [gadget], ownedAssignments: { monitor: 'owned' }, items: [{}], nameFieldKeys: ['monitor'],
    SWIPEABLE_ROW_PROPS: {}, SWIPE_OPEN_THRESHOLD: 40,
    itemProductName: () => 'Edited Monitor', itemProductPrice: () => '15000', itemProductDate: () => '2026/10/02',
    maxIntroductionDate: new Date(), isReferencePrice: () => false, copySource: undefined,
  })
  const nodes = (value: any): any[] => {
    if (Array.isArray(value)) return value.flatMap(nodes)
    if (!value || typeof value !== 'object' || !value.props) return []
    return [value, ...nodes(value.props.children)]
  }
  const removal = row({ key: 'monitor', category: 'Monitor', name: 'モニター' }, 0).props.children
  const rendered = nodes(removal.props.children(() => {}))
  assert.equal(rendered.find((node) => node.type === 'ProductNameField')?.props.value, 'Edited Monitor')
  assert.equal(rendered.find((node) => node.type === 'TextField')?.props.value, '15000')
  assert.equal(rendered.find((node) => node.type === 'DateField')?.props.value, '2026/10/02')
  assert.equal(rendered.some((node) => node.props.children === '解除'), true)
})

test('登録済み機材の値を入力欄の初期値にし、手入力と空欄への変更を優先する', () => {
  const gadget = { ...gadgetFromProduct({ id: 'owned', name: 'Saved Monitor', category: 'Monitor', now: '' }),
    price: 10000, purchasedAt: '2026-10-01' }
  const names: Record<string, string> = {}
  const prices: Record<string, string> = {}
  const dates: Record<string, string> = {}
  const bindings = { ownedGadgetFor: () => gadget, productNames: names, productPrices: prices, productDates: dates,
    fmtPriceInput: String, formatStoredDate, lang: 'ja' }
  const name = callback('src/screens/TemplateDetailScreen.tsx', 'itemProductName', bindings)
  const price = callback('src/screens/TemplateDetailScreen.tsx', 'itemProductPrice', bindings)
  const date = callback('src/screens/TemplateDetailScreen.tsx', 'itemProductDate', bindings)
  assert.equal(name('monitor'), 'Saved Monitor')
  assert.equal(price('monitor'), '10000')
  assert.equal(date('monitor'), '2026/10/01')
  names.monitor = 'Edited Monitor'
  prices.monitor = dates.monitor = ''
  assert.equal(name('monitor'), 'Edited Monitor')
  assert.equal(price('monitor'), '')
  assert.equal(date('monitor'), '')
})

test('入力済みの枠を登録済み機材で上書きせず、新しい枠へ割り当てる', () => {
  const gadget = gadgetFromProduct({ id: 'owned', name: 'Saved Monitor', category: 'Monitor', now: '' })
  const item = { key: 'monitor', category: 'Monitor' as const, name: 'モニター' }
  const productNames = { monitor: 'New Monitor' }
  let added: any[] = []
  let assigned: Record<string, string> = {}
  const confirm = callback('src/screens/TemplateDetailScreen.tsx', 'confirmOwnedPicker', {
    items: [item], gadgets: [gadget], ownedPickerDraftIds: ['owned'], ownedAssignments: {}, productNames,
    productPrices: {}, productDates: {}, draftGadgets: {}, clearOwnedProductFields: () => {},
    ownedGadgetCategoriesNeedingSlots, assignOwnedGadgetsToTemplateItems, trimInvisible,
    defaultConnTypeForSlot: () => 'wired', template: {}, t: () => 'モニター', addedItemKeys: { current: new Set() },
    setExtraItems: (update: (previous: any[]) => any[]) => { added = update(added) },
    setOwnedSelections: (next: Record<string, string>) => { assigned = next },
    setOwnedPickerOpen: () => {}, setOwnedPickerDraftIds: () => {},
  })
  confirm()
  assert.equal(productNames.monitor, 'New Monitor')
  assert.equal(added.length, 1)
  assert.equal(assigned[added[0].key], 'owned')
  assert.equal(assigned.monitor, undefined)
})

test('金額だけ入力した枠も残し、空欄の枠に機材を選んだら古い空値を消す', () => {
  const gadget = gadgetFromProduct({ id: 'owned', name: 'Saved Monitor', category: 'Monitor', now: '' })
  const item = { key: 'monitor', category: 'Monitor' as const, name: 'モニター' }
  const productNames: Record<string, string> = { monitor: '' }
  const productPrices: Record<string, string> = { monitor: '5000' }
  let added: any[] = []
  let assigned: Record<string, string> = {}
  const cleared: string[] = []
  const confirm = callback('src/screens/TemplateDetailScreen.tsx', 'confirmOwnedPicker', {
    items: [item], gadgets: [gadget], ownedPickerDraftIds: ['owned'], ownedAssignments: {},
    productNames, productPrices, productDates: {}, draftGadgets: {},
    ownedGadgetCategoriesNeedingSlots, assignOwnedGadgetsToTemplateItems, trimInvisible,
    defaultConnTypeForSlot: () => 'wired', template: {}, t: () => 'モニター', addedItemKeys: { current: new Set() },
    setExtraItems: (update: (previous: any[]) => any[]) => { added = update(added) },
    setOwnedSelections: (next: Record<string, string>) => { assigned = next },
    clearOwnedProductFields: (key: string) => { cleared.push(key) },
    setOwnedPickerOpen: () => {}, setOwnedPickerDraftIds: () => {},
  })
  confirm()
  assert.equal(productPrices.monitor, '5000')
  assert.equal(assigned.monitor, undefined)
  assert.equal(assigned[added[0].key], 'owned')
  assert.deepEqual(cleared, [added[0].key])
})

test('機材の段で再入力・クリアした値も詳細設定と次へ進む保存に使い、端子設定を保持する', () => {
  const item = { key: 'monitor', name: 'モニター' }
  const gadget = { ...gadgetFromProduct({ id: 'draft', name: 'Old Monitor', category: 'Monitor', now: '' }),
    price: 10000, purchasedAt: '2026-10-01' }
  const names: Record<string, string> = { monitor: 'New Monitor' }
  const prices: Record<string, string> = { monitor: '0' }
  const dates: Record<string, string> = { monitor: '2026/10/02' }
  const product = callback('src/screens/TemplateDetailScreen.tsx', 'withItemProduct', {
    productNames: names, productPrices: prices, productDates: dates, productPicks: {},
    itemProductName: (key: string) => names[key], itemProductPrice: (key: string) => prices[key], itemProductDate: (key: string) => dates[key],
    trimAndTruncate, GADGET_NAME_MAX_LENGTH, parseDateInput, applyProductToGadget, lang: 'ja',
    parsePriceToJpy: (value: string) => value ? Number(value) : undefined,
  })
  const updated = product(item, gadget)
  assert.equal(updated.name, 'New Monitor')
  assert.equal(updated.price, 0)
  assert.equal(updated.purchasedAt, '2026-10-02')
  assert.equal(updated.ports, gadget.ports)
  names.monitor = prices.monitor = dates.monitor = ''
  const cleared = product(item, gadget)
  assert.equal(cleared.name, 'モニター')
  assert.equal(cleared.isPlaceholder, true)
  assert.equal(cleared.price, undefined)
  assert.equal(cleared.purchasedAt, undefined)
  assert.equal(cleared.introducedAtUnknown, true)
})

test('登録済み機材の行で編集した値を、デスク作成時に同じ機材へ保存する', async () => {
  const file = 'src/screens/TemplateDetailScreen.tsx'
  const item = { key: 'monitor', category: 'Monitor', name: 'モニター' }
  const gadget = { ...gadgetFromProduct({ id: 'owned', name: 'Old Monitor', category: 'Monitor', now: '' }),
    price: 10000, purchasedAt: '2026-10-01' }
  const productNames = { monitor: 'Edited Monitor' }
  const productPrices = { monitor: '15000' }
  const productDates = { monitor: '2026/10/02' }
  const withItemProduct = callback(file, 'withItemProduct', {
    itemProductName: () => productNames.monitor, itemProductPrice: () => productPrices.monitor,
    itemProductDate: () => productDates.monitor, productPicks: {}, trimAndTruncate,
    GADGET_NAME_MAX_LENGTH, parseDateInput, applyProductToGadget, lang: 'ja',
    parsePriceToJpy: Number,
  })
  const saved: Gadget[] = []
  const create = callback(file, 'handleApply', {
    template: {}, createInFlightRef: { current: false }, newPlanIdRef: { current: null },
    items: [item], resolvedItems: [item], specItems: [], gadgets: [gadget], plans: [],
    ownedAssignments: { monitor: 'owned' }, liveDraftGadgets: {}, reusedByKey: new Map(),
    specEdits: {}, countLockedKeys: new Set(), productPicks: {}, productNames, productPrices, productDates,
    registerAsOwned: false, returnPlanId: undefined, existingPlan: undefined,
    purposes: [], outletCount: 2, lang: 'ja', otherPurposeLabel: undefined,
    otherPurposeIcon: undefined, otherPurposeColor: undefined,
    withSpecArms: () => ({ items: [item], specs: {} }), keptPlaceholderOf: () => undefined,
    trimInvisible, gadgetCategoryKey: () => 'Monitor', ownedGadgetFor: () => gadget,
    withItemProduct, parsePriceToJpy: Number, parseDateInput,
    uuidv4: () => 'desk', autoDeskName: () => 'desk',
    setCreating: () => {}, setCreateError: () => {}, updateGadgets: async (updates: Gadget[]) => { saved.push(...updates) },
    applyTemplate: async (_template: unknown, options: any) => {
      assert.equal(options.selections.monitor, 'owned')
      await options.addGadgets([])
      await options.addPlan({ id: 'desk', selectedGadgetIds: ['owned'] })
      return 'desk'
    },
    addPlan: async (_plan: unknown, saveGadgets: () => Promise<void>) => { await saveGadgets() },
    addGadgets: async () => {}, untrackTemplateDraftGadgets: async () => {},
    clearTemplateDetailDraft: () => {}, Keyboard: { dismiss: () => {} }, saveFirstSetupDraft: async () => {},
    analytics: { error: (_name: string, error: unknown) => { throw error } },
    navigation: { isFocused: () => true, getState: () => ({ routes: [{ name: 'PlanList', key: 'list' }] }), reset: () => {} },
  })
  await create('unset')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, 'owned')
  assert.equal(saved[0].name, 'Edited Monitor')
  assert.equal(saved[0].price, 15000)
  assert.equal(saved[0].purchasedAt, '2026-10-02')
  assert.equal(JSON.stringify(saved[0].ports), JSON.stringify(gadget.ports))
})

test('デスク用SVGは保存可能な重複しない名前と描画データを持つ', () => {
  assert.equal(new Set(DESK_CATEGORY_ICONS.map((icon) => icon.name)).size, DESK_CATEGORY_ICONS.length)
  for (const icon of DESK_CATEGORY_ICONS) {
    assert.match(icon.name, /^[a-z0-9-]{1,64}$/)
    assert.match(icon.path, /^[\d\s,.a-zA-Z-]+$/)
    assert.ok(icon.path.length > 0 && icon.titleJa && icon.titleEn)
  }
})

function saveFixture(withDesk = false) {
  const gadget = gadgetFromProduct({ id: 'new', name: '棚', category: 'Other', now: '' })
  const state = { adds: 0, updates: 0, backs: 0, errors: 0, feedback: [] as string[], failDesk: false, saved: null as Gadget | null, plan: {
    id: 'desk', name: 'desk', selectedGadgetIds: ['existing'], placements: [], createdAt: '', updatedAt: '',
  } as any }
  const bindings = {
    keepsPlaceholder: () => false, trimAndTruncate: (name: string) => name.trim(), name: gadget.name,
    GADGET_NAME_MAX_LENGTH: 100, showMessage: () => { state.errors++ }, t: (key: string) => key,
    hapticSuccess: () => state.feedback.push('success'), hapticError: () => state.feedback.push('error'),
    purchasedAt: '', removedAt: '', lang: 'ja', parseDateInput: () => undefined,
    deskPlan: withDesk ? state.plan : null, parseUsagePeriodDrafts: () => ({ periods: [] }), usagePeriods: [],
    editedDeskUsage: {}, plans: [], price: '', parsePriceToJpy: () => undefined, url: '',
    saveInFlightRef: { current: false }, deleteInFlightRef: { current: false }, confirmationRef: { current: null }, draftSavedRef: { current: false },
    setIsSaving: () => {}, buildUpdatedGadget: () => gadget, planId: withDesk ? 'desk' : undefined,
    beginPlanReflection: () => {}, endPlanReflection: () => {}, isDraft: true, gadget,
    add: async (saved: Gadget) => { state.adds++; state.saved = saved }, update: async (saved: Gadget) => { state.updates++; state.saved = saved },
    localDateKey: () => '2026-10-08',
    updatePlanWith: async (_id: string, update: (plan: any) => any) => {
      if (state.failDesk) throw new Error('save failed')
      state.plan = update(state.plan)
    },
    setDeskGadgetUsage, hasCurrentDeskUsageAfterEdit, placementZone: 'back_center', placementLabel: '',
    trimInvisible: (text: string) => text.trim(), leavingOnPurposeRef: { current: false },
    navigation: { isFocused: () => true, goBack: () => { state.backs++ } },
  }
  return { state, bindings, save: callback('src/screens/GadgetDetailScreen.tsx', 'handleSave', bindings) }
}

test('追加用の詳細設定で保存すると、既存機材の更新ではなく新しい機材を登録する', async () => {
  const { state, save } = saveFixture()
  await save()
  assert.equal(state.adds, 1)
  assert.equal(state.updates, 0)
  assert.equal(state.errors, 0)
  assert.equal(state.backs, 1)
  assert.deepEqual(state.feedback, ['success'])
})

test('デスクへの追加に失敗して再試行しても機材を二重登録せず、日付未設定でもデスクに加える', async () => {
  const { state, save } = saveFixture(true)
  state.failDesk = true
  await save()
  assert.equal(state.adds, 1)
  assert.equal(state.errors, 1)
  assert.equal(state.backs, 0)
  assert.deepEqual(state.feedback, ['error'])
  state.failDesk = false
  await save()
  assert.equal(state.adds, 1)
  assert.equal(state.updates, 1)
  assert.equal(state.plan.selectedGadgetIds.join(','), 'existing,new')
  assert.equal(state.plan.placements[0].gadgetId, 'new')
  assert.equal(state.backs, 1)
  assert.deepEqual(state.feedback, ['error', 'success'])
})

test('新しく登録する機材は、導入日が未入力なら保存日の今日を導入日にする', async () => {
  const library = saveFixture()
  await library.save()
  assert.equal(library.state.saved?.purchasedAt, '2026-10-08')
  assert.equal(library.state.saved?.introducedAtUnknown, undefined)

  const desk = saveFixture(true)
  await desk.save()
  assert.equal(desk.state.saved?.purchasedAt, '2026-10-08')
  // 期間は vm の中で作られるので、プロトタイプが違って deepEqual では一致しない
  assert.equal(JSON.stringify(desk.state.plan.gadgetUsage.new.periods), JSON.stringify([{ mode: 'active', startedAt: '2026-10-08', startedAtSource: 'auto' }]))
  assert.equal(desk.state.plan.selectedGadgetIds.includes('new'), true)
})

test('前日に作った下書きも未入力の導入日は保存時の今日になる', async () => {
  for (const withDesk of [false, true]) {
    const fixture = saveFixture(withDesk)
    fixture.bindings.gadget.createdAt = '2026-10-07T03:00:00Z'
    await fixture.save()
    assert.equal(fixture.state.saved?.purchasedAt, '2026-10-08')
    assert.equal(fixture.state.saved?.createdAt, '2026-10-07T03:00:00Z')
  }
})

test('候補・撤去日だけの入力・既存機材の編集には今日を入れない', async () => {
  const candidate = saveFixture()
  const built = { ...(candidate.bindings.gadget as Gadget), isCandidate: true as const, introducedAtUnknown: true as const }
  candidate.bindings.buildUpdatedGadget = () => built
  await callback('src/screens/GadgetDetailScreen.tsx', 'handleSave', candidate.bindings)()
  assert.equal(candidate.state.saved?.purchasedAt, undefined)

  const removedOnly = saveFixture()
  Object.assign(removedOnly.bindings, { removedAt: '2026/10/01', parseDateInput: (raw: string) => raw ? '2026-10-01' : undefined })
  await callback('src/screens/GadgetDetailScreen.tsx', 'handleSave', removedOnly.bindings)()
  assert.equal(removedOnly.state.saved?.purchasedAt, undefined)

  const existing = saveFixture()
  existing.bindings.isDraft = false
  await callback('src/screens/GadgetDetailScreen.tsx', 'handleSave', existing.bindings)()
  assert.equal(existing.state.updates, 1)
  assert.equal(existing.state.saved?.purchasedAt, undefined)
})

test('ジャンルを渡して開いた追加画面は、選び直させずにそのジャンルで詳細設定を開く', () => {
  const calls: unknown[][] = []
  const pendingDetailRef = { current: null as Gadget | null }
  const draftRegistrationIdRef = { current: null as string | null }
  const navigation = { isFocused: () => true, navigate: (...args: unknown[]) => calls.push(args) }
  const openPendingDetail = callback('src/screens/AddGadgetScreen.tsx', 'openPendingDetail', { pendingDetailRef, draftRegistrationIdRef, navigation, planId: 'desk', leavingRef: { current: false } })
  const prepareDraft = callback('src/screens/AddGadgetScreen.tsx', 'prepareDraft', {
    gadgetFromProduct, uuidv4: () => 'draft', trimmedQuery: '', deskGadgets: [], pendingDetailRef,
  })
  const register = callback('src/screens/AddGadgetScreen.tsx', 'registerInFilter', {
    filter: { category: 'Webcam' }, prepareDraft, openPendingDetail,
    detailOpeningRef: { current: false }, leavingRef: { current: false }, savingRef: { current: false }, navigation,
  })
  register()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'GadgetDetail')
  assert.equal((calls[0][1] as any).draftGadget.category, 'Webcam')
  assert.equal(draftRegistrationIdRef.current, 'draft')
})

test('ジャンルを続けて2度押しても、登録の数え先は開いた1つ目の下書きのまま', () => {
  // 1つ目で詳細設定へ進んだ瞬間に、この画面は前面でなくなる。2つ目の下書きは開かれないので、
  // 数え先をそちらへ移すと、開いた1つ目を保存しても「追加しました」が出ず、もう一度登録されていた
  const calls: unknown[][] = []
  const ids = ['first', 'second']
  const pendingDetailRef = { current: null as Gadget | null }
  const draftRegistrationIdRef = { current: null as string | null }
  const navigation = { isFocused: () => calls.length === 0, navigate: (...args: unknown[]) => calls.push(args) }
  const detailOpeningRef = { current: false }
  const openPendingDetail = callback('src/screens/AddGadgetScreen.tsx', 'openPendingDetail', { pendingDetailRef, draftRegistrationIdRef, navigation, planId: undefined, leavingRef: { current: false }, detailOpeningRef })
  const prepareDraft = callback('src/screens/AddGadgetScreen.tsx', 'prepareDraft', {
    gadgetFromProduct, uuidv4: () => ids.shift(), trimmedQuery: '', deskGadgets: [], pendingDetailRef,
  })
  const choose = callback('src/screens/AddGadgetScreen.tsx', 'chooseCategory', {
    pickerPurpose: null, directCategorySelection: true, setPickerPurpose: () => {},
    prepareDraft, openPendingDetail, Platform: { OS: 'android' },
    detailOpeningRef, leavingRef: { current: false }, savingRef: { current: false }, pickerPurposeRef: { current: null }, navigation,
  })
  choose('Monitor')
  choose('Keyboard')
  assert.equal(calls.length, 1)
  assert.equal((calls[0][1] as any).draftGadget.id, 'first')
  assert.equal(draftRegistrationIdRef.current, 'first')
  assert.equal(pendingDetailRef.current, null)
})

test('導入日のシートで答える前に商品を続けて押しても、先に押した商品を捨てない', async () => {
  // シートが出るまでの間に次を押すと待ちが上書きされ、先に押した商品が黙って捨てられていた
  const shown: unknown[] = []
  const registered: unknown[][] = []
  const pendingRegistrationRef = { current: null as { name: string } | null }
  // assert.equal は型を絞り込むので、空になったのを確かめた後も読めるよう関数を通す
  const pendingName = () => pendingRegistrationRef.current?.name
  const introductionDateChoiceRef = { current: null as string | null }
  const setPendingRegistration = (value: unknown) => shown.push(value)
  const register = callback('src/screens/AddGadgetScreen.tsx', 'register', {
    savingRef: { current: false }, trimAndTruncate, GADGET_NAME_MAX_LENGTH,
    introductionDateChoiceRef, pendingRegistrationRef, setPendingRegistration,
  })
  await register({ category: 'Monitor' }, 'Dell U2724D')
  await register({ category: 'Keyboard' }, 'HHKB Professional')
  assert.equal(pendingName(), 'Dell U2724D')
  assert.equal(shown.length, 1)

  const choose = callback('src/screens/AddGadgetScreen.tsx', 'choosePendingIntroductionDate', {
    pendingRegistrationRef, introductionDateChoiceRef, setPendingRegistration,
    register: (...args: unknown[]) => registered.push(args),
  })
  choose('today')
  assert.equal(introductionDateChoiceRef.current, 'today')
  assert.equal(pendingRegistrationRef.current, null)
  assert.deepEqual(registered.map((args) => args[1]), ['Dell U2724D'])

  // シートを閉じたら待ちを外し、次に押した商品でまた聞く
  introductionDateChoiceRef.current = null
  await register({ category: 'Mouse' }, 'MX Master 3S')
  const dismiss = callback('src/screens/AddGadgetScreen.tsx', 'dismissPendingRegistration', {
    pendingRegistrationRef, setPendingRegistration,
  })
  dismiss()
  assert.equal(pendingRegistrationRef.current, null)
  await register({ category: 'Speaker' }, 'Edifier R1280T')
  assert.equal(pendingName(), 'Edifier R1280T')
})

test('「デスクにも追加」の保存に失敗したら知らせてシートを残し、押し直せば閉じる', async () => {
  const state = { visible: [] as boolean[], backs: 0, messages: [] as unknown[][], fail: true, writes: 0 }
  const gadget = gadgetFromProduct({ id: 'new', name: 'Dell U2724D', category: 'Monitor', now: '' })
  const finishPlanPickerInFlightRef = { current: false }
  const finish = callback('src/screens/AddGadgetScreen.tsx', 'finishPlanPicker', {
    finishPlanPickerInFlightRef, added: [gadget], libraryGadgets: [], selectedPlanIds: new Set(['desk']),
    plans: [{ id: 'desk' }], lang: 'ja',
    updatePlanWith: async () => {
      state.writes++
      if (state.fail) throw new Error('offline')
    },
    updateDeskGadgetSelection: (plan: unknown) => plan,
    setPlanPickerVisible: (value: boolean) => state.visible.push(value),
    navigation: { isFocused: () => true, goBack: () => { state.backs++ } },
    hapticError: () => {}, showMessage: (...args: unknown[]) => state.messages.push(args),
    setTimeout: (fn: () => void) => fn(),
  })
  await finish(true)
  assert.equal(state.messages.length, 1)
  assert.equal(state.messages[0][0], 'デスクに追加できませんでした')
  assert.deepEqual(state.visible, [])
  assert.equal(state.backs, 0)
  assert.equal(finishPlanPickerInFlightRef.current, false)

  state.fail = false
  await finish(true)
  assert.equal(state.writes, 2)
  assert.deepEqual(state.visible, [false])
  assert.equal(state.backs, 1)
})
