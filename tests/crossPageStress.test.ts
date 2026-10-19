import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'

const noop = () => {}
const compiled = new Map<string, string>()
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function callback(file: string, name: string, bindings: Record<string, any>) {
  const key = `${file}:${name}`
  if (compiled.has(key)) return runInNewContext(compiled.get(key)!, { Date, Promise, ...bindings }) as (...args: any[]) => any
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (name === 'wiringDiscardListener' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0]?.getText(source).includes('profileEditModeRef.current')) expression = node.arguments[0]
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useCallback'
        ? node.initializer.arguments[0] : node.initializer
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `${file}: ${name}`)
  const code = ts.transpileModule(`(${expression.getText(source).replace(/^export /, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  compiled.set(key, code)
  return runInNewContext(code, { Date, Promise, ...bindings }) as (...args: any[]) => any
}
function attribute(file: string, prop: string, contains: string, bindings: Record<string, any>) {
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === prop && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression?.getText(parsed).includes(contains)) expression = node.initializer.expression
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(expression, `${file}: ${prop}/${contains}`)
  return runInNewContext(ts.transpileModule(`(${expression.getText(parsed)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, bindings) as (...args: any[]) => any
}
function stack(initial: string, names: string[]) {
  const router = StackRouter({ initialRouteName: initial })
  const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} }
  let state = router.getInitialState(options)
  let active = true
  const apply = (action: any) => {
    const next = router.getStateForAction(state, action, options)
    if (next) state = router.getRehydratedState(next, options)
  }
  const navigation = () => {
    const key = state.routes[state.index].key
    return {
      isFocused: () => active && state.routes[state.index].key === key,
      canGoBack: () => state.index > 0,
      getState: () => state,
      navigate: (name: string, params?: any) => apply({ ...CommonActions.navigate(name, params), source: key }),
      push: (name: string, params?: any) => apply({ ...StackActions.push(name, params), source: key }),
      replace: (name: string, params?: any) => apply({ ...StackActions.replace(name, params), source: key }),
      goBack: () => apply({ ...CommonActions.goBack(), source: key }),
      reset: (next: any) => apply(CommonActions.reset(next)),
      setParams: (params: any) => apply({ ...CommonActions.setParams(params), source: key }),
      dispatch: apply,
    }
  }
  return { navigation, top: () => ({ ...state.routes[state.index], params: state.routes[state.index].params as Record<string, any> | undefined }), state: () => state,
    dispatch: apply,
    blur: () => { active = false }, focus: () => { active = true } }
}
function tabEntry() {
  const plan = stack('PlanList', ['PlanList', 'PurposeSelection', 'TemplateDetail', 'AddGadget'])
  const feed = stack('DeskFeed', ['DeskFeed', 'BrandProducts', 'Settings', 'PublicDesk'])
  plan.blur()
  const alerts: any[] = []
  const parent = {
    getState: () => ({ key: 'tabs', routes: [{ name: 'PlanTab', state: plan.state() }, { name: 'FeedTab', state: feed.state() }] }),
    navigate: (name: string) => { if (name === 'PlanTab') { plan.focus(); feed.blur() } else { plan.blur(); feed.focus() } },
    dispatch: (action: any) => { if (action.target === plan.state().key) plan.dispatch(action); else feed.dispatch(action) },
  }
  const confirm = callback('src/utils/tabNavigation.ts', 'confirmDiscardUnfinished', {
    UNFINISHED_SETUP_SCREENS: new Set(['PurposeSelection', 'TemplateDetail']),
    pendingTabEntries: new WeakMap(), Alert: { alert: (...args: any[]) => alerts.push(args) },
  })
  const enter = callback('src/utils/tabNavigation.ts', 'navigateInTab', {
    StackActions, confirmDiscardUnfinished: confirm,
    freshStackAction: callback('src/utils/tabNavigation.ts', 'freshStackAction', { CommonActions }),
    sameParams: callback('src/utils/tabNavigation.ts', 'sameParams', {}),
  })
  return { plan, feed, parent, alerts, enter, navigation: () => ({ ...feed.navigation(), getParent: () => parent }) }
}

test('01 起動・認証: 初回案内とパスワード更新の遅い完了は、移動先を置き換えない', async () => {
  for (const seed of CONTROL_TEST_SEEDS) for (const screen of ['Onboarding', 'ResetPassword']) {
    const random = seededRandom(seed)
    const h = stack(screen, [screen, 'Login', 'MainTabs'])
    const navigation = h.navigation()
    const gate = deferred<any>()
    const alerts: unknown[] = []
    let writes = 0
    const persist = () => { writes++; return gate.promise }
    const run = callback(`src/screens/${screen}Screen.tsx`, screen === 'Onboarding' ? 'handleStart' : 'handleSubmit', {
      navigation, startInFlightRef: { current: false }, submitInFlightRef: { current: false },
      analytics: { track: noop, error: noop }, EVENTS: {}, startedAt: { current: 0 },
      markOnboardingDone: persist, skipAuth: async () => {}, withTimeout: (value: unknown) => value,
      STORAGE_TIMEOUT_MS: 1000, QUICK_TIMEOUT_MS: 1000, newPw: 'example-pass', confirmPw: 'example-pass',
      setError: noop, setSaving: noop, lang: 'ja', localizedErrorMessage: String,
      supabase: { auth: { updateUser: persist } }, Alert: { alert: (...args: unknown[]) => alerts.push(args) },
    })
    const work = run('current')
    for (let i = 0; i < 50; i++) void run(random(2) ? 'current' : 'explore')
    assert.equal(writes, 1)
    navigation.push('Login')
    const current = h.top().key
    gate.resolve({ error: null })
    await work
    assert.equal(h.top().key, current)
    assert.equal(h.state().routes[0].name, screen)
    assert.equal(alerts.length, 0)
    h.navigation().goBack()
    assert.equal(navigation.isFocused(), true)
    await run('current')
    assert.equal(writes, 2)
    assert.equal(h.top().name, 'MainTabs')
  }
})

test('02 デスク作成: 進捗バーを連打しても戻り先を作り直さず、別の段の操作を壊さない', () => {
  const back = callback('src/navigation/setupStepNavigation.ts', 'backToSetupStep', {})
  const resume = callback('src/navigation/setupStepNavigation.ts', 'resumeSetupStep', {})
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const h = stack('PlanList', ['PlanList', 'PurposeSelection', 'TemplateDetail', 'GadgetSelection', 'DeskPlacement', 'PhotoFill', 'WiringResult'])
    h.navigation().push('PurposeSelection', { purposes: ['work'] })
    const purposeKey = h.top().key
    h.navigation().push('TemplateDetail', { returnPlanId: 'desk-a' })
    h.navigation().push('DeskPlacement', { planId: 'desk-a' })
    const old = h.navigation()
    for (let i = 0; i < 80; i++) back(old, 'PurposeSelection', { intent: 'organize', purposes: [random(2) ? 'work' : 'gaming'] })
    assert.equal(h.top().key, purposeKey)
    resume(h.navigation(), { name: 'TemplateDetail', params: { templateId: 'current', returnPlanId: 'desk-a' } }, { purposes: ['work'] })
    const nextKey = h.top().key
    for (let i = 0; i < 80; i++) back(old, 'PurposeSelection', { purposes: ['gaming'] })
    assert.equal(h.top().key, nextKey)
    assert.equal(h.top().params?.returnPlanId, 'desk-a')
  }
})

test('04 デスク一覧・配線図: 連打や別画面の古いボタンで、開いたデスクのIDを切り替えない', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const h = stack('PlanList', ['PlanList', 'WiringResult', 'AddGadget', 'Settings'])
    const navigation = h.navigation()
    const open = callback('src/screens/PlanListScreen.tsx', 'handlePlanPress', {
      navigation, recordPlanOpened: noop, analytics: { track: noop }, EVENTS: {},
      setupDraft: null, openGearStepById: noop,
    })
    const plan = (id: string) => ({ id, wiringResult: {}, selectedGadgetIds: [], createdAt: '2026-10-18' })
    open(plan('desk-a'))
    for (let i = 0; i < 80; i++) {
      open(plan(random(2) ? 'desk-a' : 'desk-b'))
      assert.equal(h.top().params?.planId, 'desk-a')
    }
    assert.equal(h.top().params?.planId, 'desk-a')
    const wiring = h.navigation()
    const add = callback('src/screens/WiringResultScreen.tsx', 'openGadgetAdd', { navigation: wiring, planId: 'desk-a' })
    add()
    const detailKey = h.top().key
    for (let i = 0; i < 80; i++) { open(plan('desk-b')); add() }
    assert.equal(h.top().key, detailKey)
    assert.equal(h.top().params?.planId, 'desk-a')
  }
})

test('05 写真・商品: 保存待ちに別ページを開いたら戻らず、古い完了ボタンで再保存もしない', async () => {
  for (const screen of ['PhotoFill', 'ProductFill']) {
    const h = stack('WiringResult', ['WiringResult', 'PhotoFill', 'ProductFill', 'ConnectionMethod'])
    h.navigation().push(screen, { planId: 'desk-a' })
    const navigation = h.navigation()
    const gate = deferred<void>()
    let saves = 0
    const save = async () => { saves++; await gate.promise; return true }
    const run = callback(`src/screens/${screen}Screen.tsx`, screen === 'PhotoFill' ? 'finish' : 'handleSave', {
      navigation, finishInFlightRef: { current: false }, saveInFlightRef: { current: false }, setFinishing: noop,
      saveDeskDetails: save, fromSetup: true, planId: 'desk-a', ja: true,
      targets: [{ id: 'gadget-a' }], values: { 'gadget-a': 'Product' }, picked: {}, trimInvisible: (text: string) => text.trim(),
      setSaving: noop, setSaveError: noop, beginPlanReflection: noop, endPlanReflection: noop,
      saveProductFillEntries: save, updateMany: noop, draftSettledRef: { current: false },
      analytics: { error: noop }, Alert: { alert: () => assert.fail('別画面へ警告を出している') }, lang: 'ja',
    })
    const pending = run()
    for (let i = 0; i < 80; i++) void run()
    assert.equal(saves, 1)
    navigation.push('ConnectionMethod', { planId: 'desk-b' })
    const key = h.top().key
    gate.resolve()
    await pending
    for (let i = 0; i < 80; i++) await run()
    assert.equal(saves, 1)
    assert.equal(h.top().key, key)
    assert.equal(h.top().params?.planId, 'desk-b')
  }
})

test('05 つなぎ方: 再描画前の付属ボタン連打を反映し、離れた後の古い操作は保存しない', async () => {
  const h = stack('WiringResult', ['WiringResult', 'ConnectionMethod', 'PhotoFill'])
  h.navigation().push('ConnectionMethod')
  const navigation = h.navigation()
  let plan: any = { connectionMap: { connections: [{ id: 'a' }, { id: 'b' }] } }
  let writes = 0
  const choose = callback('src/screens/ConnectionMethodScreen.tsx', 'setChoice', {
    navigation, planId: 'desk-a',
    updateWith: async (_id: string, update: (previous: any) => any) => { writes++; plan = update(plan) },
  })
  const group = [{ id: 'a' }]
  for (let i = 0; i < 40; i++) choose(group, { kind: 'included' })
  await flush()
  assert.equal(plan.connectionMap.connections[0].cableChoice, undefined)
  choose(group, { kind: 'included' })
  assert.equal(plan.connectionMap.connections[0].cableChoice.kind, 'included')
  assert.equal(plan.connectionMap.connections[1].cableChoice, undefined)
  navigation.push('PhotoFill', { planId: 'desk-b' })
  for (let i = 0; i < 80; i++) choose(group, undefined)
  assert.equal(writes, 41)
})

test('06 探索・更新: 検索結果の別種の札を混ぜて連打しても最初の遷移先を保ち、戻ってまた開ける', () => {
  for (const seed of CONTROL_TEST_SEEDS) for (const initial of ['DeskFeed', 'DeskUpdates']) {
    const random = seededRandom(seed)
    const h = stack(initial, [initial, 'PublicDesk', 'PublicProfile', 'BrandProducts'])
    for (let round = 0; round < 30; round++) {
      const navigation = h.navigation()
      const bindings = { navigation, rememberSearch: noop, searchQuery: 'Monitor', setGuideClosed: noop,
        markOpened: noop, setOpenedIds: noop, brandKey: (brand: string) => brand, brandDisplay: (brand: string) => brand, lang: 'ja' }
      const open = callback(`src/screens/${initial}Screen.tsx`, initial === 'DeskFeed' ? 'openDesk' : 'handleOpen', bindings)
      const others = initial === 'DeskFeed' ? ['openProfile', 'openBrand'].map(name => callback('src/screens/DeskFeedScreen.tsx', name, bindings)) : [open]
      open(`desk-${round}`)
      const key = h.top().key
      for (let i = 0; i < 80; i++) (random(2) ? open : others[random(others.length)])('other')
      assert.equal(h.top().key, key)
      assert.equal(h.top().params?.deskId, `desk-${round}`)
      const back = callback('src/components/molecules/AppStackHeader.tsx', 'handleBack', { navigation: h.navigation() })
      for (let i = 0; i < 80; i++) back()
      assert.equal(h.top().name, initial)
      assert.equal(h.state().routes.length, 1)
    }
  }
})

test('07 公開ページ: デスク・持ち主・別デスクを往復しても元のIDと戻る順番を保つ', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const h = stack('DeskFeed', ['DeskFeed', 'PublicDesk', 'PublicProfile', 'BrandProducts', 'AddGadget'])
    h.navigation().push('PublicDesk', { deskId: 'origin' })
    const origin = h.top().key
    for (let round = 0; round < 30; round++) {
      const desk = h.navigation()
      const profile = attribute('src/screens/PublicDeskScreen.tsx', 'onPress', "navigation.push('PublicProfile'", {
        navigation: desk, ownerTag: 'owner', profileOpenable: true,
      })
      profile()
      const profileKey = h.top().key
      for (let i = 0; i < 50; i++) profile()
      assert.equal(h.top().key, profileKey)
      const open = callback('src/screens/PublicProfileScreen.tsx', 'openDesk', { navigation: h.navigation() })
      open(`desk-${round}`)
      const next = h.top().key
      for (let i = 0; i < 50; i++) { profile(); open(`other-${random(10)}`) }
      assert.equal(h.top().key, next)
      const similar = callback('src/screens/PublicDeskScreen.tsx', random(2) ? 'openSimilarDesk' : 'openAnotherPublicDesk', { navigation: h.navigation() })
      similar('similar')
      for (let i = 0; i < 50; i++) similar('other')
      assert.equal(h.top().params?.deskId, 'similar')
      for (let i = 0; i < 3; i++) h.navigation().goBack()
      assert.equal(h.top().key, origin)
      assert.equal(h.top().params?.deskId, 'origin')
    }
  }
})

test('07 ブランド: 別タブへの登録を連打しても一件だけ開き、元の一覧へ戻って選び直せる', () => {
  const h = tabEntry()
  h.feed.navigation().push('BrandProducts', { brandKey: 'brand-a' })
  for (let round = 0; round < 30; round++) {
    const navigation = h.navigation()
    const open = attribute('src/screens/BrandProductsScreen.tsx', 'onPress', 'navigateInTab(', {
      navigation, navigateInTab: h.enter, item: { id: `product-${round}` }, identity: { displayName: `Product ${round}` },
    })
    open()
    const key = h.plan.top().key
    for (let i = 0; i < 80; i++) h.enter(navigation, 'PlanTab', 'AddGadget', { presetId: 'other', presetName: 'Other' })
    assert.equal(h.plan.top().key, key)
    assert.equal(h.plan.top().params?.presetId, `product-${round}`)
    assert.equal(h.plan.state().routes.length, 2)
    h.plan.navigation().goBack()
    h.parent.navigate('FeedTab')
  }
})

test('08 マイページの各一覧: 移動後の古い札で機材・デスク・投稿者のIDを差し替えない', () => {
  const cases = [
    ['ViewHistoryList', 'PublicDesk', 'handleOpen', 'deskId'],
    ['BookmarkList', 'PublicDesk', 'handleOpen', 'deskId'],
    ['PublishedDeskList', 'WiringResult', 'openDesk', 'planId'],
    ['MyPage', 'PublicProfile', 'openMyProfile', 'tag'],
    ['GadgetLibrary', 'GadgetDetail', 'onEdit', 'gadgetId'],
    ['FollowingList', 'PublicProfile', 'onPress', 'tag'],
  ]
  for (const [screen, destination, name, param] of cases) {
    const h = stack('MyPage', ['MyPage', 'PublicDesk', 'PublicProfile', 'FollowingList', 'WiringResult', 'GadgetDetail'])
    if (screen === 'FollowingList') h.navigation().push('FollowingList')
    const navigation = h.navigation()
    const bindings = { navigation, active: true, setInfoGadget: noop, markSeen: async () => {}, setSeen: noop, deskUpdateStamp: () => '',
      itemsRef: { current: [] }, rowsRef: { current: ['a', 'b'].map(id => ({ key: id, planId: id })) },
      plansRef: { current: ['a', 'b'].map(id => ({ id, wiringResult: {} })) }, gadgetsRef: { current: [] },
      setupDraftRef: { current: null }, markPlanOpenedAt: async () => {}, item: { tag: 'a' } }
    const file = `src/screens/${screen}Screen.tsx`
    const open = screen === 'GadgetLibrary' ? attribute(file, 'onEdit', "navigation.navigate('GadgetDetail'", bindings)
      : screen === 'FollowingList' ? attribute(file, 'onPress', 'item.tag', bindings) : callback(file, name, bindings)
    open(screen === 'GadgetLibrary' ? { id: 'a' } : 'a')
    assert.equal(h.top().name, destination)
    const key = h.top().key
    bindings.item.tag = 'b'
    for (let i = 0; i < 80; i++) open(screen === 'GadgetLibrary' ? { id: 'b' } : 'b')
    assert.equal(h.top().key, key, screen)
    assert.equal((h.top().params as any)?.[param], 'a', screen)
  }
})

test('08 統計: 入力へ戻るを連打しても、直前の画面より前まで戻らない', () => {
  const h = stack('MyPage', ['MyPage', 'Settings', 'GadgetStats'])
  h.navigation().push('Settings')
  const previous = h.top().key
  h.navigation().push('GadgetStats')
  const back = attribute('src/screens/GadgetStatsScreen.tsx', 'onFillPrice', 'goBack()', { navigation: h.navigation() })
  for (let i = 0; i < 80; i++) back()
  assert.equal(h.top().key, previous)
})

test('09 設定・共有: 別タブの作成確認を重ねず、古い承認で移動先の作業を捨てない', () => {
  const h = tabEntry()
  h.plan.focus()
  h.plan.navigation().push('TemplateDetail', { templateId: 'existing' })
  const original = h.plan.top().key
  h.parent.navigate('FeedTab')
  h.feed.navigation().push('Settings')
  const navigation = h.navigation()
  const open = () => h.enter(navigation, 'PlanTab', 'PurposeSelection', {}, { fresh: true, lang: 'ja' })
  for (let i = 0; i < 80; i++) open()
  assert.equal(h.alerts.length, 1)
  h.alerts[0][2][0].onPress()
  open()
  h.alerts[0][2][1].onPress()
  assert.equal(h.plan.top().key, original)
  navigation.push('PublicDesk', { deskId: 'other' })
  const current = h.feed.top().key
  h.alerts[1][2][1].onPress()
  assert.equal(h.plan.top().key, original)
  assert.equal(h.feed.top().key, current)
  assert.equal(h.feed.navigation().isFocused(), true)
})

test('09 設定の各節・共通ヘッダー: 古い節のタップで内容を差し替えず、戻る連打で二画面閉じない', () => {
  const h = stack('MyPage', ['MyPage', 'Settings', 'SettingsSection', 'AICoachList'])
  h.navigation().push('Settings')
  const previous = h.top().key
  const item = { key: 'appearance' }
  const open = attribute('src/screens/SettingsScreen.tsx', 'onPress', "navigation.navigate('SettingsSection'", { navigation: h.navigation(), s: item })
  open()
  item.key = 'account'
  for (let i = 0; i < 80; i++) open()
  assert.equal((h.top().params as any)?.section, 'appearance')
  const back = attribute('src/navigation/RootNavigator.tsx', 'onPress', 'navigation.goBack()', { navigation: h.navigation() })
  for (let i = 0; i < 80; i++) back()
  assert.equal(h.top().key, previous)
})

test('09 デスク編集: 戻る確認の連打とキャンセル後の古い承認は、別のページを閉じない', () => {
  let listener: (event: any) => void = noop
  let focused = true
  let dispatched = 0
  const confirmations: any[] = []
  const setup = callback('src/screens/WiringResultScreen.tsx', 'wiringDiscardListener', {
    navigation: { addListener: (_name: string, fn: typeof listener) => { listener = fn; return noop },
      isFocused: () => focused, dispatch: () => { dispatched++ } },
    profileEditModeRef: { current: true }, profileEditedRef: { current: () => true }, isProfileSaving: false, lang: 'ja',
    confirmDiscardChanges: (_lang: string, confirm: () => void, cancel: () => void) => confirmations.push({ confirm, cancel }),
  })
  const cleanup = setup()
  const back = () => listener({ preventDefault: noop, data: { action: CommonActions.goBack() } })
  for (let i = 0; i < 80; i++) back()
  assert.equal(confirmations.length, 1)
  confirmations[0].cancel()
  back()
  confirmations[0].confirm()
  assert.equal(dispatched, 0)
  focused = false
  confirmations[1].confirm()
  assert.equal(dispatched, 0)
  focused = true
  back()
  assert.equal(confirmations.length, 3)
  confirmations[1].confirm()
  assert.equal(dispatched, 0)
  cleanup()
  confirmations[2].confirm()
  assert.equal(dispatched, 0)
})

test('10 課金: 購入・復元後の古い完了確認で、新しく開いたログイン画面を閉じない', async () => {
  for (const name of ['handleRestore', 'handlePurchase']) {
    const h = stack('MainTabs', ['MainTabs', 'Paywall', 'Login'])
    h.navigation().push('Paywall')
    const navigation = h.navigation()
    const gate = deferred<boolean>()
    const alerts: any[] = []
    let requests = 0
    const billing = () => { requests++; return gate.promise }
    const run = callback('src/screens/PaywallScreen.tsx', name, {
      navigation, billingInFlightRef: { current: false }, user: { id: 'user' }, ja: true, lang: 'ja',
      setRestoring: noop, setPurchasing: noop, analytics: { track: noop }, EVENTS: {},
      withTimeout: (value: unknown) => value, QUICK_TIMEOUT_MS: 1000, restore: billing, purchase: billing,
      Alert: { alert: (...args: any[]) => alerts.push(args) }, hapticSuccess: noop,
      findPackageForPlan: () => ({ product: { identifier: 'test-plan' } }), packages: [], selectedPlan: {}, selectedId: 'pro_monthly', reason: 'aiFeatures', planId: 'desk-a',
    })
    const pending = run()
    for (let i = 0; i < 80; i++) void run()
    assert.equal(requests, 1)
    gate.resolve(true)
    await pending
    assert.equal(alerts.length, 1)
    navigation.push('Login')
    const current = h.top().key
    for (let i = 0; i < 80; i++) alerts[0][2][0].onPress()
    assert.equal(h.top().key, current, name)
  }
})

test('10 AI相談: 履歴から再び相談を開いた後、前の相談の履歴ボタンを受け付けない', () => {
  const h = stack('AICoachList', ['AICoachList', 'AICoachChat', 'Paywall', 'Login'])
  const open = callback('src/screens/AICoachListScreen.tsx', 'openNewChat', { navigation: h.navigation() })
  for (let i = 0; i < 80; i++) open()
  assert.equal(h.state().routes.length, 2)
  const history = attribute('src/screens/AICoachChatScreen.tsx', 'onPress', "navigation.navigate('AICoachList'", { navigation: h.navigation() })
  history()
  h.navigation().push('AICoachChat', { conversationId: 'another' })
  const current = h.top().key
  for (let i = 0; i < 80; i++) history()
  assert.equal(h.top().key, current)
  assert.equal(h.top().params?.conversationId, 'another')
})

test('10 AIの新しい会話: 設定の読み込みを重ねず、画面移動・会話変更後の遅い結果で会話を消さない', async () => {
  for (const change of ['page', 'conversation', 'request']) {
    const h = stack('AICoachChat', ['AICoachChat', 'AICoachList'])
    const gate = deferred<boolean>()
    const convIdRef = { current: 'original' }
    const requestTokenRef = { current: 1 }
    let reads = 0
    let resets = 0
    const alerts: any[] = []
    const run = callback('src/screens/AICoachChatScreen.tsx', 'handleNewChat', {
      navigation: h.navigation(), newChatConfirmationRef: { current: null }, convIdRef, requestTokenRef,
      messagesRef: { current: [{}, {}] }, input: '', attachedPlan: null, attachedImage: null, isLoading: false, lang: 'ja',
      resetConversation: () => { resets++ }, isAIHistoryEnabled: () => { reads++; return gate.promise },
      Alert: { alert: (...args: any[]) => alerts.push(args) },
    })
    for (let i = 0; i < 80; i++) run()
    if (change === 'page') h.navigation().push('AICoachList')
    else if (change === 'conversation') convIdRef.current = 'another'
    else requestTokenRef.current++
    gate.resolve(true)
    await flush()
    assert.equal(resets, 0)
    assert.equal(reads, 1)
    assert.equal(alerts.length, 0)
  }
})

test('10 AIの新しい会話: キャンセルした古い確認は再利用せず、復帰後は改めて開始できる', async () => {
  const h = stack('AICoachChat', ['AICoachChat', 'AICoachList'])
  const navigation = h.navigation()
  const alerts: any[] = []
  let resets = 0
  const run = callback('src/screens/AICoachChatScreen.tsx', 'handleNewChat', {
    navigation, newChatConfirmationRef: { current: null }, convIdRef: { current: 'original' }, requestTokenRef: { current: 1 },
    messagesRef: { current: [{}, {}] }, input: '', attachedPlan: null, attachedImage: null, isLoading: false, lang: 'ja',
    resetConversation: () => { resets++ }, isAIHistoryEnabled: async () => false,
    Alert: { alert: (...args: any[]) => alerts.push(args) },
  })
  for (let i = 0; i < 80; i++) run()
  await flush()
  assert.equal(alerts.length, 1)
  alerts[0][2][0].onPress()
  run(); await flush()
  alerts[0][2][1].onPress()
  assert.equal(resets, 0)
  navigation.push('AICoachList')
  alerts[1][2][1].onPress()
  assert.equal(resets, 0)
  h.navigation().goBack()
  run(); await flush()
  for (let i = 0; i < 80; i++) alerts[2][2][1].onPress()
  assert.equal(resets, 1)
})
