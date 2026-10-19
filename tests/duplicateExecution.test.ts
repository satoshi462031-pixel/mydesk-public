import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { restoreAt } from '../src/utils/fullSwipe'
import { createIntentSync } from '../src/utils/intentSync'
import { CommonActions, StackActions, StackRouter, TabRouter } from '@react-navigation/routers'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'
import { immediateRemoval } from './helpers/removalMotion'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function handler(file: string, name: string, bindings: Record<string, any>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  function visit(node: ts.Node) {
    if (name === 'coachListFocus' && ts.isCallExpression(node) && node.expression.getText(source) === 'useFocusEffect') {
      const callback = node.arguments[0]
      if (callback && ts.isCallExpression(callback)) found = callback.arguments[0]
    }
    if (name === 'purgeExpired' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0]?.getText(source).includes('purgingExpiredRef.current')) found = node.arguments[0]
    if (name === 'myPageTabPress' && ts.isCallExpression(node) && node.expression.getText(source) === 'tabs.addListener'
      && node.arguments[0]?.getText(source) === "'tabPress'") found = node.arguments[1]
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      found = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useCallback'
        ? node.initializer.arguments[0] : node.initializer
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, name)
  const module = { exports: undefined as any }
  const code = ts.transpileModule(`module.exports = (${found.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { module, Error, Promise, Date, confirmationRef: { current: null }, removal: immediateRemoval, trashRemoval: immediateRemoval, animateListChange: () => {}, reduceMotion: false, hapticSuccess: () => {}, hapticError: () => {}, hapticWarning: () => {}, ...bindings })
  return module.exports
}

const settings = 'src/screens/SettingsScreen.tsx'
const profile = 'src/components/organisms/ProfileEditSheet.tsx'
const library = 'src/screens/GadgetLibraryScreen.tsx'
const subscription = 'src/context/SubscriptionContext.tsx'
const noop = () => {}

test('写真画面の完了は再描画前の連打でも一度だけ保存し、失敗後は再試行できる', async () => {
  const gate = deferred<boolean>()
  let calls = 0
  let backs = 0
  let errors = 0
  const bindings = { finishing: false, finishInFlightRef: { current: false }, setFinishing: noop,
    saveDeskDetails: () => { calls++; return calls === 1 ? gate.promise : Promise.resolve(true) },
    navigation: { isFocused: () => true, goBack: () => { backs++ } }, fromSetup: false,
    ja: true, Alert: { alert: () => { errors++ } } }
  const finish = handler('src/screens/PhotoFillScreen.tsx', 'finish', bindings)
  const pending = finish()
  await finish()
  assert.equal(calls, 1)
  gate.reject(new Error('disk full'))
  await pending
  assert.equal(errors, 1)
  await finish()
  assert.equal(calls, 2)
  assert.equal(backs, 1)
})

test('ブロック解除は同じ行と別の行を続けて押しても重複しない', async () => {
  const gate = deferred<void>()
  const calls: string[] = []
  const bindings = { busyId: null, unblockInFlightRef: { current: false }, setBusyId: noop,
    unblockUser: (id: string) => { calls.push(id); return calls.length === 1 ? gate.promise : Promise.resolve() },
    withTimeout: (work: unknown) => work, QUICK_TIMEOUT_MS: 1, setItems: noop,
    visibleRef: { current: true }, Alert: { alert: noop }, localizedErrorMessage: () => '', ja: true, lang: 'ja' }
  const unblock = handler('src/components/organisms/BlockedUsersModal.tsx', 'handleUnblock', bindings)
  const pending = unblock('a')
  await unblock('a'); await unblock('b')
  assert.deepEqual(calls, ['a'])
  gate.reject(new Error('offline'))
  await pending
  await unblock('b')
  assert.deepEqual(calls, ['a', 'b'])
})

test('自作ジャンルは保存・削除確認・削除を重ねず、キャンセルと失敗で操作を戻す', async () => {
  const gate = deferred<any>()
  const calls: string[] = []
  const alerts: any[] = []
  let closed = 0
  const bindings = { canSave: true, editing: { id: 'cat', name: 'Category' }, trimmedName: 'Updated', icon: 'shape', color: '#123456',
    operationInFlightRef: { current: false }, setSaving: noop, onSaved: () => { calls.push('saved') }, onClose: () => { closed++ },
    update: () => { calls.push('save'); return gate.promise }, add: noop,
    usageCount: () => 0, remove: async () => { calls.push('delete'); return true },
    Alert: { alert: (...args: any[]) => { alerts.push(args) } }, lang: 'ja' }
  const file = 'src/components/organisms/CustomCategoryEditor.tsx'
  const save = handler(file, 'handleSave', bindings)
  const remove = handler(file, 'handleDelete', bindings)
  const pending = save()
  await save(); remove()
  assert.deepEqual(calls, ['save'])
  assert.equal(alerts.length, 0)
  gate.reject(new Error('disk full'))
  await pending
  alerts.length = 0
  remove(); remove(); await save()
  assert.equal(alerts.length, 1)
  alerts[0][2][0].onPress()
  remove()
  alerts[1][2][1].onPress()
  await save()
  await flush()
  assert.deepEqual(calls, ['save', 'delete'])
  assert.equal(closed, 1)
  remove()
  alerts[2][3].onDismiss()
  assert.equal(bindings.operationInFlightRef.current, false)
})

test('公開・更新・公開範囲変更・公開停止は別ボタンでも同時に開始しない', async () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    let gate = deferred<any>()
    const calls: string[] = []
    const bindings: any = {
      publishInFlightRef: { current: false }, updateInFlightRef: { current: false }, changingVisibility: false,
      user: { id: 'user' }, plan: { images: ['photo'] }, planId: 'plan', gadgets: [], lang: 'ja',
      canUpdatePublicPage: true, publishedVisibility: 'public',
      publishGadgetIssue: () => null, promptGadgetIssue: noop, getPublicNickname: async () => 'name',
      saveFreshWiring: async () => ({ images: ['photo'] }), updateWith: noop,
      publishPlan: () => { calls.push('publish'); return gate.promise },
      setPlanVisibility: () => { calls.push('visibility'); return gate.promise },
      unpublishPlan: () => { calls.push('unpublish'); return gate.promise },
      withTimeout: (work: unknown) => work, PUBLISH_TIMEOUT_MS: 1, QUICK_TIMEOUT_MS: 1,
      recoverPendingPublications: async () => [], publishStateOf: () => 'public', isOutdatedPublishState: () => false,
      isPhotoRevocationIncomplete: () => false, userErrorMessage: () => '', Alert: { alert: noop },
      setPublishedDeskId: noop, setPublishedVisibilityState: noop, setPlanPublishState: noop, setPublishState: noop,
      setPublishError: noop, setIsUpdating: noop, setChangingVisibility: noop, setPublishModalVisible: noop, setSavedToast: noop,
    }
    const file = 'src/screens/WiringResultScreen.tsx'
    const publish = handler(file, 'handlePublish', bindings)
    const update = handler(file, 'handleUpdate', bindings)
    const visibility = handler(file, 'handleChangeVisibility', bindings)
    const unpublish = handler(file, 'handleUnpublish', bindings)
    const actions = [() => publish('public'), () => update(), () => visibility('unlisted'), () => unpublish()]
    for (let batch = 0; batch < 16; batch++) {
      gate = deferred<any>()
      const pending = actions[batch % 4]()
      await flush()
      const started = calls.length
      const others = Array.from({ length: 10 }, () => actions[random(4)]())
      await flush()
      const count = calls.length
      if (batch % 2) gate.reject(new Error('offline'))
      else gate.resolve('desk')
      await Promise.all([pending, ...others])
      assert.equal(count, started, `batch ${batch}`)
      assert.equal(bindings.publishInFlightRef.current, false)
    }
  }
})

test('ログイン画面を離れた後の認証成功は、今いる別画面を閉じない', () => {
  let focused = false
  let backs = 0
  const finished = { current: false }
  const finish = handler('src/screens/LoginScreen.tsx', 'finishLogin', {
    loginFinishedRef: finished, fromOnboarding: false,
    navigation: { isFocused: () => focused, canGoBack: () => true, goBack: () => { backs++ } },
  })
  finish()
  assert.equal(backs, 0)
  focused = true
  finish(); finish()
  assert.equal(backs, 1)
})

test('認証中のスキップとスキップ中の認証を防ぎ、スキップ失敗後に再試行できる', async () => {
  const gate = deferred<void>()
  const calls: string[] = []
  const bindings: any = {
    skipInFlightRef: { current: false }, submitInFlightRef: { current: true }, socialInFlightRef: { current: false },
    setLoading: noop, setError: noop, localizedErrorMessage: () => 'error', lang: 'ja', fromOnboarding: false,
    skipAuth: () => { calls.push('skip'); return calls.length === 1 ? gate.promise : Promise.resolve() },
    finishLogin: () => { calls.push('finish') }, navigation: { isFocused: () => true, canGoBack: () => true, goBack: () => { calls.push('finish') } },
    email: 'a@example.test', password: 'password', mode: 'signin',
  }
  const file = 'src/screens/LoginScreen.tsx'
  const skip = handler(file, 'handleSkip', bindings)
  await skip()
  assert.deepEqual(calls, [])
  bindings.submitInFlightRef.current = false
  const pending = skip()
  await skip()
  await handler(file, 'handleSubmit', bindings)()
  await handler(file, 'handleSocialSignIn', bindings)('google')
  assert.deepEqual(calls, ['skip'])
  gate.reject(new Error('offline'))
  await pending
  assert.equal(bindings.skipInFlightRef.current, false)
  await skip()
  assert.deepEqual(calls, ['skip', 'skip', 'finish'])
})

for (const screen of ['PurposeSelection', 'GadgetSelection', 'GadgetSelectionWizard', 'DeskPlacement', 'TemplateDetail']) {
  test(`${screen}: 保存待ちに戻ったら遷移せず、開いたままなら次へ進む`, async () => {
    for (const leave of [true, false]) {
      const gate = deferred<void>()
      let focused = true
      let saved = 0
      const destinations: unknown[] = []
      const errors: unknown[] = []
      const navigation = { isFocused: () => focused, getState: () => ({ routes: [{ name: 'PlanList', key: 'list' }] }),
        navigate: (...args: unknown[]) => { destinations.push(args) },
        reset: (...args: unknown[]) => { destinations.push(args) }, replace: (...args: unknown[]) => { destinations.push(args) },
        // 離れたまま終わったときは前面に戻るのを待つだけ（このテストでは戻らない）
        addListener: () => () => {} }
      const plan = { id: 'plan', selectedGadgetIds: [], images: [] }
      const wiring = { connections: [], requiredCables: [], warnings: [] }
      const persist = async () => { saved++; await gate.promise }
      const bindings: any = {
        navigation, plan, planId: 'plan', gadgets: [], lang: 'ja',
        analytics: { track: noop, error: (...args: unknown[]) => errors.push(args) }, EVENTS: {}, errorProperties: () => ({}),
        Alert: { alert: (...args: unknown[]) => errors.push(args) },
        nextInFlightRef: { current: false }, generationInFlightRef: { current: false }, createInFlightRef: { current: false },
        setGenerating: noop, setGenerationError: (value: boolean) => { if (value) errors.push('generation') },
        setGenerationStep: noop, setCreating: noop, setCreateError: (value: boolean) => { if (value) errors.push('create') },
        invalidColor: false, selected: new Set(['work']), intent: 'organize', otherLabel: '',
        returnPlanId: 'plan', plans: [plan], updatePlanWith: persist, resume: null, copySource: null,
        openGearStep: (...args: unknown[]) => { destinations.push(args) },
        setTimeout: (fn: () => void) => { fn(); return 0 }, outletCount: 2, deletedGadgetIds: new Set(),
        updateDeskGadgetSelection: (prev: unknown) => prev, applyDeskGadgetUsage: (_p: unknown, gadget: unknown) => gadget,
        generateWiring: () => wiring, reconcileMap: () => [], pauseForPaint: async () => {}, nodeOffsets: {},
        wizard: screen === 'GadgetSelectionWizard', saveFirstSetupDraft: async () => {},
        updateWith: async (_id: unknown, update: (previous: unknown) => unknown) => { update(plan); await persist() },
        template: {}, items: [], resolvedItems: [], specItems: [], reusedByKey: new Map(),
        ownedAssignments: {}, liveDraftGadgets: {}, existingPlan: plan, withSpecArms: () => ({ items: [], specs: {} }),
        registerAsOwned: false, specEdits: {}, productNames: {}, productPicks: {}, productDates: {}, productPrices: {},
        purposes: [], otherPurposeLabel: undefined, otherPurposeIcon: undefined, otherPurposeColor: undefined,
        addPlan: noop, autoDeskName: () => 'desk', applyTemplate: async () => { await persist(); return 'plan' },
        untrackTemplateDraftGadgets: async () => {}, clearTemplateDetailDraft: noop, Keyboard: { dismiss: noop },
      }
      const name = screen === 'DeskPlacement' ? 'finishPlacement' : screen === 'TemplateDetail' ? 'handleApply' : 'handleNext'
      const file = `src/screens/${screen === 'GadgetSelectionWizard' ? 'GadgetSelection' : screen}Screen.tsx`
      const run = handler(file, name, bindings)
      const pending = run()
      await flush()
      assert.equal(saved, 1)
      await run()
      assert.equal(saved, 1, '待機中の連打では再保存しない')
      if (leave) focused = false
      gate.resolve()
      await pending
      assert.deepEqual(errors, [])
      assert.equal(destinations.length, leave ? 0 : 1)
      assert.equal(bindings.nextInFlightRef.current, false)
      assert.equal(bindings.generationInFlightRef.current, false)
      assert.equal(bindings.createInFlightRef.current, false)
    }
  })
}

test('機材作成は実物設定・所有確認・日付確認の退場を順に待ち、連打で保存を重複しない', async () => {
  for (const registerAsOwned of [false, true]) {
    const file = 'src/screens/TemplateDetailScreen.tsx'
    const item = { key: 'monitor', category: 'Monitor', name: 'Monitor' }
    const gate = deferred<void>()
    const events: string[] = []
    let ownership = 0
    let missingDate = 0
    const bindings: any = {
      pendingApplyRef: { current: null }, createInFlightRef: { current: false }, newPlanIdRef: { current: null },
      setSpecOpen: (open: boolean) => events.push(`spec:${open}`),
      setSpecConfirmed: noop,
      setOwnershipAskCount: (count: number) => { ownership = count },
      setMissingDateCount: (count: number) => { missingDate = count },
      template: {}, items: [item], resolvedItems: [item], specItems: [], gadgets: [], plans: [],
      ownedAssignments: {}, liveDraftGadgets: {}, reusedByKey: new Map(), specEdits: {}, productPicks: {},
      ownedGadgetFor: () => undefined,
      productNames: { monitor: 'My Monitor' }, productPrices: {}, productDates: {}, registerAsOwned,
      returnPlanId: undefined, existingPlan: undefined, purposes: [], outletCount: 2, lang: 'ja',
      otherPurposeLabel: undefined, otherPurposeIcon: undefined, otherPurposeColor: undefined,
      withSpecArms: () => ({ items: [item], specs: {} }), keptPlaceholderOf: () => undefined,
      trimInvisible: (value: string) => value.trim(), uuidv4: () => 'desk', autoDeskName: () => 'desk',
      setCreating: noop, setCreateError: (error: boolean) => { assert.equal(error, false) },
      applyTemplate: async (_template: unknown, options: any) => {
        assert.equal(options.registerAsOwned, true)
        events.push('save'); await gate.promise; return 'desk'
      },
      addPlan: noop, untrackTemplateDraftGadgets: async () => {}, clearTemplateDetailDraft: noop, Keyboard: { dismiss: noop },
      saveFirstSetupDraft: async () => {}, analytics: { error: (_name: string, error: unknown) => { throw error } },
      navigation: { isFocused: () => true, getState: () => ({ routes: [{ name: 'PlanList', key: 'list' }] }),
        reset: (state: any) => { assert.equal(state.routes[1].name, 'DeskPlacement'); events.push('layout') } },
    }
    bindings.handleApply = handler(file, 'handleApply', bindings)
    const queue = handler(file, 'closeSheetAndApply', bindings)
    const dismissed = handler(file, 'applyAfterSheetDismiss', bindings)
    queue('spec'); queue('spec')
    assert.deepEqual(events, ['spec:false'])
    assert.equal(ownership, 0)
    assert.equal(missingDate, 0)
    dismissed('date')
    assert.ok(bindings.pendingApplyRef.current, '別の画面の終了通知では再開しない')
    dismissed('spec'); dismissed('spec')
    if (!registerAsOwned) {
      assert.equal(ownership, 1)
      assert.equal(missingDate, 0)
      queue('ownership', undefined, true)
      assert.equal(ownership, 0)
      assert.equal(missingDate, 0)
      dismissed('ownership')
    }
    assert.equal(missingDate, 1)
    assert.equal(events.includes('save'), false)
    queue('date', 'unset', true); queue('date', 'today', true)
    assert.equal(missingDate, 0)
    dismissed('date'); dismissed('date')
    assert.equal(events.filter(event => event === 'save').length, 1)
    assert.equal(events.includes('layout'), false)
    gate.resolve()
    await flush()
    assert.deepEqual(events, ['spec:false', 'save', 'layout'])
    assert.equal(bindings.createInFlightRef.current, false)
  }
})

test('実物設定の確定後は上の配置から再開でき、閉じる通知が来なくても同じ保存を一度だけ進める', () => {
  const file = 'src/screens/TemplateDetailScreen.tsx'
  let opens = 0
  let applied = 0
  let errors = 0
  let inputError: string | null = null
  const bindings: any = {
    specConfirmed: false, pendingApplyRef: { current: null }, createInFlightRef: { current: false },
    navigation: { isFocused: () => true }, items: [{}], removingKeys: new Set(),
    purchaseInputError: () => inputError, lang: 'ja', showMessage: () => { errors++ },
    registerAsOwned: false, handleCreatePress: () => { opens++ },
    setOwnershipAskCount: noop, setMissingDateCount: noop,
    handleApply: (dateChoice?: string, owned?: boolean) => {
      applied++
      assert.equal(dateChoice, 'unset')
      assert.equal(owned, true)
      bindings.createInFlightRef.current = true
    },
  }
  bindings.applyAfterSheetDismiss = handler(file, 'applyAfterSheetDismiss', bindings)
  const press = () => handler(file, 'handleLayoutStepPress', bindings)()
  press()
  assert.equal(opens, 1, '初回は実物設定を開く')
  bindings.specConfirmed = true
  bindings.pendingApplyRef.current = { sheet: 'date', dateChoice: 'unset', owned: true }
  inputError = '日付が不正'
  press()
  assert.equal(errors, 1)
  assert.equal(applied, 0, '上の配置からも入力検証を通す')
  inputError = null
  press(); press()
  assert.equal(applied, 1)
  assert.equal(opens, 1, '確定した実物設定を再度開かない')
  assert.equal(bindings.pendingApplyRef.current, null)
  bindings.applyAfterSheetDismiss('date')
  assert.equal(applied, 1, '遅れて終了通知が来ても二重保存しない')
  bindings.createInFlightRef.current = false
  bindings.handleApply = (dateChoice: string, owned: boolean) => {
    applied++
    assert.equal(dateChoice, 'unset', '未入力の導入日は未設定のまま保存する')
    assert.equal(owned, false, '所有状態は今の選択を使う')
  }
  press()
  assert.equal(applied, 2, '待機中の処理が無い場合も現在の内容で配置へ進む')
})

test('新規デスクの配置ステップは実物設定の確定後に押せ、保存中や機材削除中は進めない', () => {
  const file = 'src/screens/TemplateDetailScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const callbacks: Record<string, string> = {}
  function visit(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'SetupProgress') {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          callbacks[attr.name.getText(source)] = attr.initializer.expression.getText(source)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  let advances = 0
  const bindings = { specConfirmed: false, returnPlanId: undefined as string | undefined,
    creating: false, items: [{}], removingKeys: new Set(['removing']), handleLayoutStepPress: () => { advances++ } }
  const callback = (name: string) => runInNewContext(ts.transpileModule(`(${callbacks[name]})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, bindings) as (step: number) => boolean | void
  assert.equal(callback('canNavigate')(2), false)
  bindings.removingKeys.clear()
  assert.equal(callback('canNavigate')(2), false, '新規作成は確定前に飛ばない')
  bindings.specConfirmed = true
  assert.equal(callback('canNavigate')(2), true)
  callback('onStepPress')(2)
  assert.equal(advances, 1)
  assert.equal(callback('canNavigate')(3), false, '写真へは飛ばさない')
  bindings.creating = true
  assert.equal(callback('canNavigate')(2), false)
  bindings.creating = false
  bindings.removingKeys.add('removing')
  assert.equal(callback('canNavigate')(2), false)
  bindings.removingKeys.clear()
  bindings.items = []
  assert.equal(callback('canNavigate')(2), false)
  bindings.items = [{}]
  bindings.specConfirmed = false
  bindings.returnPlanId = 'existing'
  assert.equal(callback('canNavigate')(2), true, '既存デスクからの戻りも維持する')
})

test('購入・復元の開始直後の閉じる操作を防ぎ、処理終了後は閉じられる', () => {
  let closed = 0
  const busy = { current: true }
  const close = handler('src/screens/PaywallScreen.tsx', 'handleDismiss', {
    billingInFlightRef: busy, analytics: { track: noop }, EVENTS: {}, reason: 'test',
    navigation: { isFocused: () => true, goBack: () => { closed++ } },
  })
  close(); close()
  assert.equal(closed, 0)
  busy.current = false
  close()
  assert.equal(closed, 1)
})

test('共通ヘッダーの戻るを連打しても、閉じた画面のボタンで前の画面まで戻らない', () => {
  const router = StackRouter({})
  const options = { routeNames: ['List', 'Detail', 'Editor'], routeParamList: {}, routeGetIdList: {} }
  let state = router.getInitialState(options)
  for (const name of ['Detail', 'Editor']) {
    const next = router.getStateForAction(state, StackActions.push(name), options)
    assert.ok(next && next.stale === false)
    state = next
  }
  const editor = state.routes[state.index]
  const navigation = {
    isFocused: () => state.routes[state.index].key === editor.key,
    goBack: () => {
      const next = router.getStateForAction(state, { ...CommonActions.goBack(), source: editor.key }, options)
      assert.ok(next && next.stale === false)
      state = next
    },
  }
  const back = handler('src/components/molecules/AppStackHeader.tsx', 'handleBack', { navigation })
  back(); back(); back()
  assert.equal(state.routes[state.index].name, 'Detail')
  assert.equal(state.routes.length, 2)
})

test('相談履歴の保存設定はランダムな連打も順に保存し、古い失敗で途中の値へ戻さない', async () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    let displayed = true
    let persisted = true
    const writes: { value: boolean; gate: ReturnType<typeof deferred<void>> }[] = []
    const ref = { current: true }
    const sync = createIntentSync<string>({
      send: async (_key, value) => {
        const gate = deferred<void>()
        writes.push({ value, gate })
        await gate.promise
        persisted = value
      },
      onFailed: (_key, value) => { ref.current = value; displayed = value },
    })
    const toggle = handler('src/screens/AICoachListScreen.tsx', 'handleHistoryToggle', {
      historyEnabledRef: ref, historyChangeRef: { current: 0 }, historySync: sync,
      setHistoryEnabledState: (value: boolean) => { displayed = value },
    })
    for (let batch = 0; batch < 30; batch++) {
      let expected: boolean = displayed
      for (let i = 0; i < 10; i++) {
        expected = random(2) === 1
        toggle(expected)
        assert.equal(displayed, expected)
      }
      while (writes.length) {
        const { gate } = writes.shift()!
        gate.resolve()
        await flush()
      }
      assert.equal(persisted, expected)
    }
    toggle(!persisted)
    toggle(persisted)
    writes.shift()!.gate.reject(new Error('disk full'))
    await flush()
    assert.equal(displayed, persisted)
    toggle(!persisted)
    writes.shift()!.gate.resolve()
    await flush()
    assert.equal(displayed, persisted)
  }
})

test('相談履歴設定の古い読み込みは、保存完了後も操作した値を上書きしない', async () => {
  for (const changed of [false, true]) {
    const read = deferred<boolean>()
    let displayed = true
    const version = { current: 0 }
    const valueRef = { current: true }
    const focus = handler('src/screens/AICoachListScreen.tsx', 'coachListFocus', {
      historyChangeRef: version, historyEnabledRef: valueRef, historySync: { isBusy: () => false },
      loadConversations: async () => [], isAIHistoryEnabled: () => read.promise, refresh: noop,
      setConversations: noop, setConvsLoaded: noop, setHistoryEnabledState: (value: boolean) => { displayed = value },
    })
    focus()
    if (changed) { version.current++; valueRef.current = true }
    read.resolve(false)
    await flush()
    assert.equal(displayed, changed)
    assert.equal(valueRef.current, changed)
  }
})

function bottomTabs(initialIndex = 0, nested = false) {
  const names = ['PlanTab', 'FeedTab', 'SettingsTab']
  const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} }
  const router = TabRouter({ initialRouteName: names[initialIndex] })
  let state = router.getInitialState(options)
  if (nested) state = { ...state, routes: state.routes.map((route) => ({
    ...route, params: { screen: 'Detail', params: { deskId: route.name } },
    state: { stale: false, type: 'stack', key: `stack-${route.key}`, index: 1,
      routeNames: ['List', 'Detail'], routes: [{ key: `list-${route.key}`, name: 'List' }, { key: `detail-${route.key}`, name: 'Detail' }] },
  })) }
  const dispatched: any[] = []
  const navigation = {
    getState: () => state,
    dispatch: (action: any) => {
      dispatched.push(action)
      if (action.type === 'POP_TO_TOP') {
        assert.ok(state.routes.some((route) => route.state?.key === action.target))
        state = { ...state, routes: state.routes.map((route) => {
          const stack = route.state
          if (!stack || stack.stale !== false || stack.key !== action.target) return route
          return { ...route, state: { ...stack, index: 0, routes: stack.routes.slice(0, 1) } }
        }) }
        return
      }
      assert.equal(action.target, state.key)
      const next = router.getStateForAction(state, action, options)
      assert.ok(next && next.stale === false)
      state = next
    },
    emit: ({ target }: { target: string }) => {
      const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
      const route = state.routes.find((item) => item.key === target)!
      listen({ navigation, route }).tabPress(event)
      return event
    },
  }
  const listen = handler('src/navigation/RootNavigator.tsx', 'popToTopOnTabPress', {
    hapticSelection: noop, CommonActions, StackActions,
  })
  let presses = new Map<string, () => void>()
  const render = () => {
    const snapshot = state
    presses = new Map(snapshot.routes.map((route, index) => [route.name, handler(
      'node_modules/@react-navigation/bottom-tabs/src/views/BottomTabBar.tsx', 'onPress', {
        navigation, route, focused: index === snapshot.index, state: snapshot, CommonActions,
      },
    )]))
  }
  render()
  return { render, press: (name: string) => presses.get(name)!(),
    selected: () => state.routes[state.index].name, state: () => state, dispatched }
}

test('下部3タブは再描画前に交互連打しても、最後に押したタブへ毎回移動する', () => {
  const names = ['PlanTab', 'FeedTab', 'SettingsTab']
  for (let initialIndex = 0; initialIndex < names.length; initialIndex++) {
    const tabs = bottomTabs(initialIndex)
    for (let i = 0; i < 30; i++) {
      for (const next of [names[(initialIndex + 1) % 3], names[initialIndex], names[(initialIndex + 2) % 3], names[initialIndex]]) {
        tabs.press(next)
        assert.equal(tabs.selected(), next)
      }
      if (i % 5 === 0) tabs.render()
    }
    assert.equal(tabs.dispatched.length, 120, '1タップで切り替えを重複送信しない')
  }
})

test('下部3タブはランダムな連打・同じタブの再タップ・再描画を混ぜても最後の選択を保つ', () => {
  const names = ['PlanTab', 'FeedTab', 'SettingsTab']
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    for (let initial = 0; initial < names.length; initial++) {
      const tabs = bottomTabs(initial, true)
      const expectedDepth = [1, 1, 1]
      const original = tabs.state().routes
      let selected = initial
      for (let i = 0; i < 500; i++) {
        const next = random(names.length)
        if (next === selected) expectedDepth[next] = 0
        tabs.press(names[next])
        selected = next
        assert.equal(tabs.selected(), names[next], `seed=${seed}, step=${i}`)
        tabs.state().routes.forEach((route, index) => {
          assert.equal(route.state?.index, expectedDepth[index])
          assert.equal(route.params, original[index].params)
        })
        if (random(4) === 0) tabs.render()
      }
    }
  }
})

test('交互連打は各タブの詳細とパラメータを保ち、選択中の再タップだけ一覧へ戻す', () => {
  const tabs = bottomTabs(0, true)
  const original = tabs.state().routes
  for (const name of ['FeedTab', 'PlanTab', 'SettingsTab', 'FeedTab', 'SettingsTab', 'PlanTab']) {
    tabs.press(name)
    assert.equal(tabs.selected(), name)
    assert.ok(tabs.state().routes.every((route, i) => route.state === original[i].state && route.params === original[i].params))
  }
  tabs.press('PlanTab')
  assert.equal(tabs.dispatched.at(-1).type, 'POP_TO_TOP')
  assert.equal(tabs.state().routes[0].state?.index, 0)
  assert.equal(tabs.state().routes[1].state?.index, 1)
  assert.equal(tabs.state().routes[2].state?.index, 1)
  const count = tabs.dispatched.length
  tabs.press('PlanTab')
  assert.equal(tabs.dispatched.length, count, '一覧の再タップは標準の先頭スクロールを妨げない')
})

test('マイページへのタブ切り替えは内部4タブを戻さず、再タップしたときだけデスクへ戻す', () => {
  const selected: string[] = []
  let focused = true
  const onPress = handler('src/screens/MyPageScreen.tsx', 'myPageTabPress', {
    navigation: { isFocused: () => focused }, scrollOffsetsRef: { current: { gadgets: 0 } },
    tabPressStateRef: { current: { tab: 'gadgets', visibleTab: 'gadgets', selectTab: (key: string) => selected.push(key) } },
  })
  onPress({ defaultPrevented: true })
  assert.deepEqual(selected, [])
  focused = false
  onPress({ defaultPrevented: false })
  assert.deepEqual(selected, [])
  focused = true
  onPress({ defaultPrevented: false })
  assert.deepEqual(selected, ['published'])
})

test('下部タブは切り替えと一覧へ戻るときだけ振動し、一覧の再タップでは振動しない', () => {
  let feedback = 0
  let pops = 0
  let switches = 0
  let prevented = 0
  for (const scenario of ['switch', 'root', 'nested', 'unmounted']) {
    const listen = handler('src/navigation/RootNavigator.tsx', 'popToTopOnTabPress', {
      hapticSelection: () => { feedback++ }, StackActions, CommonActions,
    })
    const { tabPress } = listen({
      navigation: {
        getState: () => ({ index: 0, routes: [{ key: 'current', state: scenario === 'unmounted' ? undefined : { key: 'stack', index: scenario === 'nested' ? 2 : 0 } }] }),
        dispatch: (action: { type: string }) => { if (action.type === 'POP_TO_TOP') pops++; else switches++ },
      },
      route: { key: scenario === 'switch' ? 'other' : 'current' },
    })
    tabPress({ preventDefault: () => { prevented++ } })
  }
  assert.equal(feedback, 2)
  assert.equal(pops, 1)
  assert.equal(switches, 1)
  assert.equal(prevented, 2)
})

const removeLock = (kind: string) => kind === 'desk'
  ? {
    removeInFlightRef: { current: new Set<string>() }, setRemovingIds: noop, setReleasingIds: noop, withoutId: (ids: Set<string>) => ids,
    removalSeqRef: { current: 0 }, removedAtRef: { current: new Map<string, number>() },
  }
  : { removeInFlightRef: { current: false }, setRemovingId: noop, loadRequestRef: { current: 0 }, setRefreshing: noop }

test('desk: 保存解除は別のデスクなら送信中でも続けて外せる', async () => {
  const gate = deferred<void>()
  const removed: string[] = []
  const run = handler('src/screens/BookmarkListScreen.tsx', 'handleRemove', {
    user: { id: 'me' }, ...removeLock('desk'),
    removeBookmark: (id: string) => { removed.push(id); return gate.promise }, setItems: noop,
    hapticSelection: noop, analytics: { track: noop }, EVENTS: {}, ja: true, Alert: { alert: noop },
  })
  const first = run('one')
  const second = run('two')
  assert.deepEqual(removed, ['one', 'two'])
  gate.resolve()
  await Promise.all([first, second])
})

for (const kind of ['desk', 'gear']) {
  // 左へ引ききって外したときは、その場で一覧から外して「元に戻す」を出し、サーバーからは期限が過ぎてから外す
  test(`${kind}: 引ききった保存解除はすぐ一覧から外し、送信は元に戻すの期限後。戻すと元の位置、失敗したら戻して知らせる`, async () => {
    const one = kind === 'desk' ? { desk_id: 'one', desk: { title: 'A' } } : { id: 'one', product_id: 'p' }
    const two = kind === 'desk' ? { desk_id: 'two', desk: { title: 'B' } } : { id: 'two', product_id: 'p' }
    let items: any[] = [one, two]
    const undos: any[] = []
    let writes = 0
    let alerts = 0
    let fail = false
    const action = async () => { writes++; if (fail) throw new Error('offline') }
    let reloads = 0
    const latestListRef = { current: { collectionId: undefined as string | undefined, reload: () => { reloads++ } } }
    const release = handler(
      kind === 'desk' ? 'src/screens/BookmarkListScreen.tsx' : 'src/components/organisms/GadgetBookmarkList.tsx',
      'releaseWithUndo',
      {
        user: { id: 'me' }, itemsRef: { get current() { return items } }, pendingReleaseRef: { current: new Set<string>() },
        collectionId: undefined, latestListRef,
        releaseTimersRef: { current: new Map() }, setReleasingIds: noop, withoutId: (ids: Set<string>) => ids,
        removedAtRef: { current: new Map<string, number>() }, removalSeqRef: { current: 0 },
        localizedDemoDeskName: (_id: string, title: string) => title, lang: 'ja', ja: true, reduceMotion: true,
        hapticSelection: noop, animateListChange: noop, restoreAt,
        setItems: (next: (prev: any[]) => any[]) => { items = next(items) },
        undoSnackbar: { showUndo: (undo: any) => { undos.push(undo) } },
        removeBookmark: action, removeGadgetBookmark: action, analytics: { track: noop }, EVENTS: {},
        Alert: { alert: () => { alerts++ } },
      },
    )
    const key = (item: any) => item.desk_id ?? item.id
    const releaseOne = () => kind === 'desk' ? release('one') : release(one, 'A')

    releaseOne()
    assert.deepEqual(items.map(key), ['two'])
    assert.equal(writes, 0)
    await undos[0].onUndo()
    assert.deepEqual(items.map(key), ['one', 'two'])
    assert.equal(writes, 0)

    releaseOne()
    await undos[1].onExpire()
    assert.equal(writes, 1)
    assert.deepEqual(items.map(key), ['two'])

    items = [one, two]
    fail = true
    releaseOne()
    await undos[2].onExpire()
    assert.deepEqual(items.map(key), ['one', 'two'])
    assert.equal(alerts, 1)

    items = [one, two]
    releaseOne()
    latestListRef.current.collectionId = 'another-folder'
    items = []
    await undos[3].onUndo()
    assert.deepEqual(items, [], '別フォルダに元の項目を直接挿入しない')
    assert.equal(reloads, 1)
  })
}

for (const kind of ['desk']) {
  // デスクは1件ずつ止める（続けて別のデスクを外せる）
  test(`${kind}: 保存解除は再描画前に同じ行を操作しても1回だけ実行し、成功時だけ振動する`, async () => {
    const gate = deferred<void>()
    let writes = 0
    let haptics = 0
    let alerts = 0
    const action = () => { writes++; return gate.promise }
    const run = handler(
      kind === 'desk' ? 'src/screens/BookmarkListScreen.tsx' : 'src/components/organisms/GadgetBookmarkList.tsx',
      kind === 'desk' ? 'handleRemove' : 'removeItem',
      {
        user: { id: 'me' }, ...removeLock(kind),
        removeBookmark: action, removeGadgetBookmark: action, setItems: noop,
        hapticSelection: () => { haptics++ }, analytics: { track: noop }, EVENTS: {}, ja: true,
        Alert: { alert: () => { alerts++ } },
      },
    )
    const args = (id: string) => kind === 'desk' ? id : { id, product_id: 'product' }
    const pending = run(args('one'))
    await run(args(kind === 'desk' ? 'one' : 'two'))
    assert.equal(writes, 1)
    assert.equal(haptics, 0)
    gate.reject(new Error('offline'))
    await pending
    assert.equal(haptics, 0)
    assert.equal(alerts, 1)
    const success = handler(
      kind === 'desk' ? 'src/screens/BookmarkListScreen.tsx' : 'src/components/organisms/GadgetBookmarkList.tsx',
      kind === 'desk' ? 'handleRemove' : 'removeItem',
      {
        user: { id: 'me' }, ...removeLock(kind),
        removeBookmark: async () => {}, removeGadgetBookmark: async () => {}, setItems: noop,
        hapticSelection: () => { haptics++ }, analytics: { track: noop }, EVENTS: {}, ja: true,
        Alert: { alert: () => { alerts++ } },
      },
    )
    await success(args('one'))
    assert.equal(haptics, 1)
    assert.equal(alerts, 1)
  })
}

for (const [name, lock, effect, args, extra] of [
  ['saveEmail', 'emailSaveInFlightRef', 'requestEmailChange', [], {
    emailText: 'new@example.com', setEditingEmail: noop, setChangingEmail: noop,
  }],
  ['runRestorePurchases', 'restorePurchasesInFlightRef', 'restorePurchases', [], {
    setRestoring: noop, analytics: { track: noop }, EVENTS: {}, errorProperties: () => ({}),
    withTimeout: (work: Promise<any>) => work, QUICK_TIMEOUT_MS: 20,
  }],
  ['changeNotifPref', 'notificationSaveInFlightRef', 'setNotificationPrefs', ['likes', true], {
    notifPrefs: { likes: false, follows: false }, setNotifPrefs: noop, setSavingNotif: noop,
  }],
  ['changeDiscoverable', 'discoverableSaveInFlightRef', 'setProfileDiscoverable', [true], {
    discoverable: false, setDiscoverable: noop, setSavingDiscoverable: noop, refreshProfile: async () => {},
  }],
  ['runExport', 'exportInFlightRef', 'exportUserData', [], {
    gadgets: [], deletedGadgets: [], folders: [], plans: [], setExporting: noop, showToast: noop,
  }],
  ['sendFeedback', 'feedbackInFlightRef', 'submitFeedback', [], {
    feedbackBody: 'description', feedbackCategory: 'bug', feedbackAttachTrail: true,
    tidyMultilineText: (text: string) => text.trim(), ctxIsDark: false, planTier: 'free',
    setFeedbackSending: noop, setFeedbackOpen: noop, setFeedbackBody: noop,
    setFeedbackCategory: noop, setFeedbackAttachTrail: noop, showToast: noop,
  }],
  ['runNotificationPermissionDebug', 'notificationDebugInFlightRef', 'debugPushPermissionPrompt', [], {
    setDebuggingNotifications: noop, __DEV__: false,
  }],
] as const) {
  test(`${name}: 再描画前の連打を一度だけ実行し、失敗後は再試行できる`, async () => {
    const first = deferred<any>()
    let calls = 0
    const bindings: any = {
      ...extra, user: { id: 'me', email: 'old@example.com' }, language: 'ja',
      settingsUserIdRef: { current: 'me' }, notifPrefsUserIdRef: { current: 'me' }, discoverableUserIdRef: { current: 'me' },
      Alert: { alert: noop }, localizedErrorMessage: () => 'failed',
      [lock]: { current: false },
      [effect]: () => { calls++; return calls === 1 ? first.promise : Promise.resolve({ supported: false }) },
    }
    const run = handler(settings, name, bindings)
    const pending = run(...args)
    await run(...args)
    assert.equal(calls, 1)
    first.reject(new Error('offline'))
    await pending
    assert.equal(bindings[lock].current, false)
    await run(...args)
    assert.equal(calls, 2)
  })
}

test('通知設定の失敗時は元へ戻し、別項目の同時保存で上書きしない', async () => {
  const write = deferred<void>()
  const states: any[] = []
  const sent: any[] = []
  const run = handler(settings, 'changeNotifPref', {
    user: { id: 'me' }, notifPrefs: { likes: false, follows: false }, notificationSaveInFlightRef: { current: false },
    settingsUserIdRef: { current: 'me' }, notifPrefsUserIdRef: { current: 'me' },
    setNotifPrefs: (value: any) => states.push(value), setSavingNotif: noop, language: 'ja',
    setNotificationPrefs: (_id: string, prefs: any) => { sent.push(prefs); return write.promise },
    Alert: { alert: noop }, localizedErrorMessage: () => 'failed',
  })
  const pending = run('likes', true)
  await run('follows', true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].likes, true)
  write.reject(new Error('offline'))
  await pending
  assert.equal(states.at(-1).likes, false)
  assert.equal(states.at(-1).follows, false)
})

test('通知許可の通常操作とデバッグ操作でOSへの要求を重ねない', async () => {
  const permission = deferred<void>()
  const calls: string[] = []
  const bindings = {
    notificationDebugInFlightRef: { current: false }, pushPermission: 'undetermined', language: 'ja',
    registerPushToken: () => { calls.push('register'); return permission.promise },
    getPushPermissionState: async () => 'granted', setPushPermission: noop,
    setDebuggingNotifications: noop, debugPushPermissionPrompt: async () => { calls.push('debug'); return { supported: false } },
    Alert: { alert: noop }, __DEV__: false,
  }
  const enable = handler(settings, 'enablePush', bindings)
  const debug = handler(settings, 'runNotificationPermissionDebug', bindings)
  const pending = enable()
  await enable()
  await debug()
  assert.deepEqual(calls, ['register'])
  permission.resolve()
  await pending
  await debug()
  assert.deepEqual(calls, ['register', 'debug'])
})

test('送信開始直後に閉じる操作をしても入力を消さず、同じフォームを保つ', () => {
  let changes = 0
  const close = handler(settings, 'closeFeedback', {
    feedbackInFlightRef: { current: true }, setFeedbackOpen: () => { changes++ },
    setFeedbackBody: () => { changes++ }, setFeedbackCategory: () => { changes++ }, setFeedbackAttachTrail: () => { changes++ },
  })
  close()
  assert.equal(changes, 0)
})

test('アカウント削除の最終確認を連打しても削除要求を重ねない', async () => {
  const prepare = deferred<string>()
  const alerts: any[][] = []
  const calls: string[] = []
  const run = handler(settings, 'handleDeleteAccount', {
    accountDeletionInFlightRef: { current: false }, language: 'ja', user: { id: 'me' }, settingsUserIdRef: { current: 'me' },
    Alert: { alert: (...args: any[]) => alerts.push(args) }, setDeletingAccount: noop,
    prepareAccountDeletion: () => { calls.push('prepare'); return prepare.promise },
    deleteAllPublishedData: async () => { calls.push('public') }, deleteAccount: async () => { calls.push('account') },
    clearGadgetsCache: async () => {}, clearPlansCache: async () => {}, clearFirstSetupDraftCache: async () => {},
    AsyncStorage: { clear: async () => {} }, finishAccountDeletion: async () => {},
    navigation: { getParent: () => null }, localizedErrorMessage: () => 'failed',
  })
  run()
  alerts[0][2][1].onPress()
  const confirm = alerts[1][2][1].onPress
  const pending = confirm()
  await confirm()
  assert.deepEqual(calls, ['prepare'])
  prepare.resolve('authorization')
  await pending
  assert.deepEqual(calls, ['prepare', 'account'])
})

test('プロフィールを開き直しても公開中の投稿者名の同期が終わるまでは次の保存を始めない', async () => {
  const sync = deferred<void>()
  const avatarWriteInFlightRef = { current: true }
  let writes = 0
  const run = handler(profile, 'save', {
    nameLoaded: true, name: 'nickname', tag: 'tag', profile: { public_tag: 'tag' }, user: { id: 'me' },
    trimAndTruncate: (text: string) => text, NAME_MAX_LENGTH: 50, normalizePublicTag: (text: string) => text,
    assertPublicContentAllowed: noop, saveInFlightRef: { current: false }, avatarWriteInFlightRef, setSaving: noop,
    visibleGenerationRef: { current: 1 }, visibleRef: { current: true },
    withTimeout: (work: Promise<any>) => work, STORAGE_TIMEOUT_MS: 5, QUICK_TIMEOUT_MS: 20,
    setPublicNickname: async () => { writes++; return 'nickname' },
    syncPublicOwnerName: () => sync.promise, onClose: noop, onSaved: noop, ja: true, lang: 'ja', Alert: { alert: noop },
  })
  await run()
  assert.equal(writes, 0)
  avatarWriteInFlightRef.current = false
  const pending = run()
  await flush()
  await run()
  assert.equal(writes, 1)
  sync.reject(new Error('offline'))
  await pending
  await run()
  assert.equal(writes, 2)
})

test('プロフィール写真の保存と削除は同時に走らず、失敗後の削除を許可する', async () => {
  const upload = deferred<string>()
  const calls: string[] = []
  const bindings = {
    user: { id: 'me' }, avatarCropAsset: { uri: 'local' }, avatarWriteInFlightRef: { current: false },
    profile: { public_avatar_url: 'old' }, setAvatarBusy: noop, ja: true, Alert: { alert: noop },
    manipulateAsync: async () => ({ uri: 'crop' }), SaveFormat: { JPEG: 'jpg' },
    uploadAvatarImage: () => { calls.push('upload'); return upload.promise },
    applyAvatar: async (url: string | null) => { calls.push(`apply:${url}`) }, setAvatarCropAsset: noop, setToast: noop,
  }
  const save = handler(profile, 'saveCroppedAvatar', bindings)
  const remove = handler(profile, 'removeAvatarConfirmed', bindings)
  const pending = save({ x: 0, y: 0, width: 1, height: 1 })
  await save({})
  await remove()
  await flush()
  assert.deepEqual(calls, ['upload'])
  upload.reject(new Error('offline'))
  await pending
  await Promise.all([remove(), remove()])
  assert.deepEqual(calls, ['upload', 'apply:null'])
})

test('ニックネーム保存がタイムアウトしても端末の書き込み完了までは重ねない', async () => {
  const write = deferred<string>()
  let writes = 0
  const lock = { current: false }
  const run = handler(profile, 'save', {
    nameLoaded: true, name: 'nickname', tag: '', profile: null, user: null,
    trimAndTruncate: (text: string) => text, NAME_MAX_LENGTH: 50, normalizePublicTag: (text: string) => text,
    assertPublicContentAllowed: noop, saveInFlightRef: lock, avatarWriteInFlightRef: { current: false }, setSaving: noop,
    visibleGenerationRef: { current: 1 }, visibleRef: { current: true },
    withTimeout: () => Promise.reject(new Error('operation timed out')), STORAGE_TIMEOUT_MS: 5,
    setPublicNickname: () => { writes++; return write.promise },
    ja: true, lang: 'ja', Alert: { alert: noop }, localizedErrorMessage: () => 'failed',
  })
  await run()
  assert.equal(lock.current, true)
  await run()
  assert.equal(writes, 1)
  write.resolve('nickname')
  await flush()
  assert.equal(lock.current, false)
  await run()
  assert.equal(writes, 2)
})

test('ガジェット削除を連打しても一度だけ実行し、削除中の保存を始めない', async () => {
  const deletion = deferred<void>()
  let deletes = 0
  const bindings = {
    deleteInFlightRef: { current: false }, saveInFlightRef: { current: false }, setIsDeleting: noop,
    leavingOnPurposeRef: { current: false }, gadget: { id: 'g' },
    deleteGadget: () => { deletes++; return deletion.promise }, navigation: { isFocused: () => false },
    showMessage: noop, lang: 'ja',
  }
  const remove = handler('src/screens/GadgetDetailScreen.tsx', 'runDelete', bindings)
  const save = handler('src/screens/GadgetDetailScreen.tsx', 'handleSave', bindings)
  const pending = remove()
  await remove()
  await save()
  assert.equal(deletes, 1)
  deletion.reject(new Error('offline'))
  await pending
  assert.equal(bindings.deleteInFlightRef.current, false)
  bindings.saveInFlightRef.current = true
  await remove()
  assert.equal(deletes, 1)
})

test('ごみ箱の復元中は完全削除を始めず、完全削除の確認連打も一度だけ実行する', async () => {
  const restoring = deferred<void>()
  const deleting = deferred<void>()
  const dialogs: any[] = []
  const calls: string[] = []
  const bindings = {
    trashOperationInFlightRef: { current: false }, setTrashBusyId: noop, ja: true, lang: 'ja', t: (key: string) => key,
    showMessage: noop, showConfirmation: (value: any) => dialogs.push(value), localizedGadgetName: () => 'gadget',
    restoreGadgets: () => { calls.push('restore'); return restoring.promise },
    deleteGadgetsPermanently: () => { calls.push('delete'); return deleting.promise },
  }
  const restore = handler(library, 'restoreTrashGadget', bindings)
  const confirm = handler(library, 'confirmPermanentDelete', bindings)
  confirm({ id: 'g' })
  const pending = restore({ id: 'g' })
  await restore({ id: 'g' })
  dialogs[0].onConfirm()
  assert.deepEqual(calls, ['restore'])
  restoring.reject(new Error('offline'))
  await pending
  dialogs[0].onConfirm()
  dialogs[0].onConfirm()
  assert.deepEqual(calls, ['restore', 'delete'])
  deleting.resolve()
  await flush()
  assert.equal(bindings.trashOperationInFlightRef.current, false)
})

test('一括削除の確認を連打しても同じ対象を一度だけ削除し、失敗後は再試行できる', async () => {
  const result = deferred<void>()
  const dialogs: any[] = []
  let calls = 0
  const run = handler(library, 'confirmBulkDelete', {
    gadgets: [{ id: 'g' }], selectedIds: new Set(['g']), bulkDeleteInFlightRef: { current: false },
    visibleGadgetIds: new Set(['g']), lang: 'ja',
    ja: true, t: (key: string) => key, showConfirmation: (value: any) => dialogs.push(value),
    setBulkDeleting: noop, deleteGadgets: () => { calls++; return result.promise }, leaveSelectionMode: noop, showMessage: noop,
  })
  run()
  dialogs[0].onConfirm()
  dialogs[0].onConfirm()
  assert.equal(calls, 1)
  result.reject(new Error('offline'))
  await flush()
  run()
  dialogs[1].onConfirm()
  await flush()
  assert.equal(calls, 2)
})

test('期限切れごみ箱の自動整理と手動の完全削除は重ならず、自動整理の失敗後は手動で再試行できる', async () => {
  const response = deferred<void>()
  const calls: string[] = []
  const dialogs: any[] = []
  const bindings = {
    trashOperationInFlightRef: { current: false }, purgingExpiredRef: { current: '' },
    expiredDeletedGadgets: [{ id: 'expired' }], deleteGadgetsPermanently: () => { calls.push('delete'); return response.promise },
    ja: true, lang: 'ja', t: (key: string) => key, localizedGadgetName: () => 'gadget',
    showConfirmation: (value: any) => dialogs.push(value), setTrashBusyId: noop, showMessage: noop,
  }
  const purge = handler(library, 'purgeExpired', bindings)
  const confirm = handler(library, 'confirmPermanentDelete', bindings)
  confirm({ id: 'manual' })
  purge()
  purge()
  dialogs[0].onConfirm()
  assert.deepEqual(calls, ['delete'])
  response.reject(new Error('offline'))
  await flush()
  assert.equal(bindings.trashOperationInFlightRef.current, false)
  assert.equal(bindings.purgingExpiredRef.current, '')
  dialogs[0].onConfirm()
  purge()
  await flush()
  assert.deepEqual(calls, ['delete', 'delete'])
})

test('購入・復元は同じ操作の結果を共有し、商品違い・別操作・アカウント切替の重複を防ぐ', async () => {
  const response = deferred<any>()
  const calls: string[] = []
  const generation = { current: 1 }
  const bindings: any = {
    Platform: { OS: 'ios' }, setupGenerationRef: generation, storeActionInFlightRef: { current: null },
    runStoreAction: async (action: () => Promise<any>) => { await action(); return true },
    require: () => ({ default: {
      purchasePackage: () => { calls.push('purchase'); return response.promise },
      restorePurchases: async () => { calls.push('restore'); return {} },
    } }),
  }
  bindings.startStoreAction = handler(subscription, 'startStoreAction', bindings)
  const purchase = handler(subscription, 'purchase', bindings)
  const restore = handler(subscription, 'restore', bindings)
  const pending = purchase({ identifier: 'monthly' })
  assert.equal(purchase({ identifier: 'monthly' }), pending)
  await assert.rejects(purchase({ identifier: 'yearly' }), /BILLING_OPERATION_IN_PROGRESS/)
  await assert.rejects(restore(), /BILLING_OPERATION_IN_PROGRESS/)
  generation.current++
  await assert.rejects(purchase({ identifier: 'monthly' }), /BILLING_OPERATION_IN_PROGRESS/)
  assert.deepEqual(calls, ['purchase'])
  response.resolve({ customerInfo: {} })
  assert.equal(await pending, true)
  await restore()
  assert.deepEqual(calls, ['purchase', 'restore'])
})

test('ストア操作が失敗してもロックを解除して再試行できる', async () => {
  const bindings = { Platform: { OS: 'ios' }, setupGenerationRef: { current: 1 }, storeActionInFlightRef: { current: null }, runStoreAction: (action: () => Promise<any>) => action() }
  const run = handler(subscription, 'startStoreAction', bindings)
  await assert.rejects(run('restore', async () => { throw new Error('offline') }), /offline/)
  assert.equal(await run('restore', async () => true), true)
})

test('desk: 保存のブックマークは押すと枠だけになり、少し置いて外れる。消える前にもう一度押せば取り消せる', async () => {
  const removed: string[] = []
  let releasing = new Set<string>()
  const toggle = handler('src/screens/BookmarkListScreen.tsx', 'toggleRelease', {
    releaseTimersRef: { current: new Map() }, hapticSelection: noop, RELEASE_DELAY_MS: 5, setTimeout, clearTimeout,
    setReleasingIds: (update: (prev: Set<string>) => Set<string>) => { releasing = update(releasing) },
    withoutId: (ids: Set<string>, id: string) => new Set([...ids].filter((v) => v !== id)),
    handleRemove: async (id: string) => { removed.push(id) },
  })
  toggle('keep')
  assert.ok(releasing.has('keep'))
  toggle('keep')
  assert.ok(!releasing.has('keep'))
  toggle('drop')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(removed, ['drop'])
})
