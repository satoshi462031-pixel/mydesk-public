import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveSubscriptionTier } from '../src/utils/purchasePackages'
import { isOfficialPublicTag } from '../src/utils/publicTag'
import { withTimeout } from '../src/utils/networkError'
import { ACCENT_COLORS_TEMPORARILY_UNLOCKED } from '../src/constants/accentColors'

function expression(file: string, name: string): string {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    if (name === 'accentPolicy' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('setAccentColorAllowed(')) found = node.arguments[0]
    if (name === 'loading' && ts.isPropertyAssignment(node) && node.name.getText(source) === 'loading') found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, name)
  return found.getText(source)
}

function evaluate(code: string, bindings: Record<string, any>) {
  const module = { exports: undefined as any }
  const output = ts.transpileModule(`module.exports = (${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, { module, ...bindings })
  return module.exports
}

const subscriptionFile = 'src/context/SubscriptionContext.tsx'

test('前のFreeアカウントの課金情報は、新しいProアカウントの色制限に使わない', () => {
  for (const [current, loading, tier, allowed] of [
    [false, false, 'free', true], [true, true, 'free', null],
    [true, false, 'pro', true], [true, false, 'free', false],
  ] as const) {
    const calls: boolean[] = []
    evaluate(expression(subscriptionFile, 'accentPolicy'), {
      ACCENT_COLORS_TEMPORARILY_UNLOCKED: false, BILLING_UNLOCKED: false, isLoading: loading, customerInfoCurrent: current, customerInfo: {}, effectiveTier: tier,
      setAccentColorAllowed: (value: boolean) => { calls.push(value) },
    })()
    assert.deepEqual(calls, allowed === null ? [] : [allowed])
  }
})

test('テーマカラーの一時開放はFree・課金待機・アカウント切替でも有効で、Pro判定は変えない', () => {
  assert.equal(ACCENT_COLORS_TEMPORARILY_UNLOCKED, true)
  for (const [current, loading, customerInfo] of [[true, false, {}], [true, true, null], [false, false, {}]] as const) {
    const calls: boolean[] = []
    const bindings = {
      ACCENT_COLORS_TEMPORARILY_UNLOCKED, BILLING_UNLOCKED: false, isLoading: loading,
      customerInfoCurrent: current, customerInfo, effectiveTier: 'free',
      setAccentColorAllowed: (value: boolean) => { calls.push(value) },
      tier: 'free', serverTier: 'free', user: null, profile: null, resolveSubscriptionTier, isOfficialPublicTag,
    }
    evaluate(expression(subscriptionFile, 'accentPolicy'), bindings)()
    assert.deepEqual(calls, [true])
    assert.equal(evaluate(expression(subscriptionFile, 'effectiveTier'), bindings), 'free')
  }
})

test('アカウント切替直後は前の権利や公式タグを引き継がず、新しい本人のPro判定を使う', () => {
  for (const [user, profile, tier, current, expected] of [
    [{ id: 'new' }, { id: 'new', tier: 'pro' }, 'free', false, 'pro'],
    [{ id: 'new' }, { id: 'old', tier: 'pro', public_tag: 'mydesk' }, 'pro', false, 'free'],
    [{ id: 'new' }, { id: 'new', tier: 'free' }, 'pro', true, 'pro'],
  ] as const) {
    const bindings = { user, profile, tier, customerInfoCurrent: current, customerInfo: {}, BILLING_UNLOCKED: false, resolveSubscriptionTier, isOfficialPublicTag }
    const serverTier = evaluate(expression(subscriptionFile, 'serverTier'), bindings)
    assert.equal(evaluate(expression(subscriptionFile, 'effectiveTier'), { ...bindings, serverTier }), expected)
  }
})

test('本編はログインした本人の復元が終わるまで表示せず、前のアカウントの完了状態を使わない', () => {
  const code = expression('src/navigation/RootNavigator.tsx', 'ready')
  for (const [readyFor, sessionUser, expected] of [[null, 'pro-user', false], ['other-user', 'pro-user', false], ['pro-user', 'pro-user', true], [null, null, true]] as const) {
    assert.equal(evaluate(code, { localReady: true, accountDataReadyFor: readyFor, session: sessionUser ? { user: { id: sessionUser } } : null }), expected)
  }
})

test('SIGNED_OUTが先に届いても、ログアウト消去中は次のログイン画面を出さない', () => {
  const code = expression('src/context/AuthContext.tsx', 'loading')
  assert.equal(evaluate(code, { loading: false, isEndingSession: true }), true)
  assert.equal(evaluate(code, { loading: false, isEndingSession: false }), false)
})

test('課金状態の再取得中にアカウントを切り替えたら、古い結果で現在の課金情報を更新しない', async () => {
  let finish!: (value: any) => void
  const info = new Promise(resolve => { finish = resolve })
  const generation = { current: 1 }
  const calls: string[] = []
  const run = evaluate(expression(subscriptionFile, 'fetchAll'), {
    syncPurchasesIdentity: async () => true, setupGenerationRef: generation, Platform: { OS: 'ios' }, QUICK_TIMEOUT_MS: 1000, withTimeout: (promise: Promise<any>) => promise,
    require: () => ({ default: { getCustomerInfo: () => info, getOfferings: async () => ({ current: { availablePackages: [] } }) } }),
    setIsLoading: (loading: boolean) => { calls.push(`loading:${loading}`) },
    handleCustomerInfo: () => { calls.push('info') }, setPackages: () => { calls.push('packages') }, setLastError: () => { calls.push('error') },
  })
  const work = run()
  generation.current = 2
  finish({ entitlements: { active: { pro: {} } } })
  await work
  assert.deepEqual(calls, ['loading:true'])
})

test('購入復元の途中で再ログインしたら、前のアカウントへの復元結果を使わない', async () => {
  let finish!: (value: any) => void
  const response = new Promise(resolve => { finish = resolve })
  const generation = { current: 1 }
  const calls: string[] = []
  const run = evaluate(expression(subscriptionFile, 'runStoreAction'), {
    syncPurchasesIdentity: async () => true, setupGenerationRef: generation, RC_ENTITLEMENT_PRO: 'pro',
    setAwaitingServerTier: (waiting: boolean) => { calls.push(`waiting:${waiting}`) },
    handleCustomerInfo: () => { calls.push('info') }, waitForServerTier: () => { calls.push('profile') },
  })
  const work = run(() => response)
  generation.current = 2
  finish({ entitlements: { active: { pro: {} } } })
  assert.equal(await work, false)
  assert.deepEqual(calls, ['waiting:true'])
})
function identityHarness(logIn: (id: string) => Promise<void>, fetchRevenueCatCustomerId = async (userId: string) => userId) {
  const calls: string[] = []
  const sdk = {
    logIn, logOut: async () => {}, configure() {},
    addCustomerInfoUpdateListener: () => { calls.push('listener:add') },
    removeCustomerInfoUpdateListener: () => { calls.push('listener:remove') },
  }
  const module = { exports: {} as any }
  const bindings: any = {
    module, user: { id: 'old' }, currentUserIdRef: { current: 'old' }, setupGenerationRef: { current: 1 },
    purchasesConfigured: true, purchasesUserId: null, purchasesIdentitySync: Promise.resolve(),
    Platform: { OS: 'ios' }, BILLING_UNLOCKED: false, RC_API_KEY_IOS: 'test', RC_API_KEY_ANDROID: 'test', RC_ENTITLEMENT_PRO: 'pro',
    QUICK_TIMEOUT_MS: 10, withTimeout, listenerRef: { current: null }, fetchRevenueCatCustomerId,
    require: () => ({ default: sdk }),
    removeCustomerInfoListener: () => { calls.push('listener:remove') },
    setIsLoading: (value: boolean) => { calls.push(`loading:${value}`) },
    setLastError: (value: string) => { calls.push(value) },
    setAwaitingServerTier: (value: boolean) => { calls.push(`waiting:${value}`) },
    handleCustomerInfo: () => { calls.push('info') }, waitForServerTier: async () => {},
    fetchAll: async () => { calls.push('fetch'); calls.push('loading:false') },
  }
  const code = ['syncPurchasesIdentity', 'setup', 'runStoreAction'].map(name => expression(subscriptionFile, name)).join('\n')
  runInNewContext(ts.transpileModule(`${code}\nmodule.exports = { syncPurchasesIdentity, setup, runStoreAction }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, bindings)
  return { bindings, ...module.exports, calls }
}

test('課金アカウント切替が応答しなくても読み込みを解き、購入は別人のIDで実行しない', async () => {
  const h = identityHarness(() => new Promise<void>(() => {}))
  await h.setup(1)
  assert.equal(h.calls.at(-1), 'loading:false')
  assert.ok(h.calls.some((value: string) => value.includes('timed out')))
  assert.equal(h.calls.includes('fetch'), false)
  let purchases = 0
  await assert.rejects(h.runStoreAction(async () => { purchases++; return {} }), /timed out/)
  assert.equal(purchases, 0)
  assert.equal(h.calls.at(-1), 'waiting:false')
})

test('課金切替の待機を打ち切ってもSDK切替は直列のまま、遅い旧ログインの後に新しい本人へ切り替える', async () => {
  let finishOld!: () => void
  const old = new Promise<void>(resolve => { finishOld = resolve })
  const identities: string[] = []
  const h = identityHarness(async (id) => { identities.push(id); if (id === 'old') await old })
  await assert.rejects(h.syncPurchasesIdentity(1), /timed out/)
  h.bindings.user = { id: 'new' }
  h.bindings.currentUserIdRef.current = 'new'
  h.bindings.setupGenerationRef.current = 2
  await assert.rejects(h.syncPurchasesIdentity(2), /timed out/)
  assert.deepEqual(identities, ['old'])
  finishOld()
  await h.bindings.purchasesIdentitySync
  assert.deepEqual(identities, ['old', 'new'])
  assert.equal(await h.syncPurchasesIdentity(2), true)
  assert.equal(h.bindings.purchasesUserId, 'new')
})

test('課金切替の遅い応答が戻った後は再試行でき、更新リスナーを重複登録しない', async () => {
  let finish!: () => void
  const response = new Promise<void>(resolve => { finish = resolve })
  const h = identityHarness(() => response)
  await h.setup(1)
  finish()
  await h.bindings.purchasesIdentitySync
  h.calls.length = 0
  await h.setup(1)
  await h.setup(1)
  assert.deepEqual(h.calls, ['loading:true', 'listener:add', 'fetch', 'loading:false', 'loading:true', 'listener:remove', 'listener:add', 'fetch', 'loading:false'])
})

test('課金SDKには公開されている利用者IDではなく、本人だけが知る顧客IDでログインする', async () => {
  const ids: string[] = []
  const h = identityHarness(async (id) => { ids.push(id) }, async (userId) => `customer-of-${userId}`)
  assert.equal(await h.syncPurchasesIdentity(1), true)
  assert.deepEqual(ids, ['customer-of-old'])
})

test('前のアカウントの課金操作コールバックは再ログイン先の購入を開始しない', async () => {
  const h = identityHarness(async () => { throw new Error('must not log in') })
  h.bindings.currentUserIdRef.current = 'new'
  assert.equal(await h.runStoreAction(async () => { throw new Error('must not purchase') }), false)
  assert.deepEqual(h.calls, ['waiting:true', 'waiting:false'])
})

test('Webの課金再試行はネイティブSDKを初期化せず待機を解除する', async () => {
  const h = identityHarness(async () => { throw new Error('must not log in') })
  h.bindings.Platform.OS = 'web'
  h.bindings.require = () => { throw new Error('must not load native SDK') }
  await h.setup(1)
  assert.deepEqual(h.calls, ['loading:false'])
})

test('古い課金再試行コールバックを再ログイン後に呼んでも、新しい画面の待機を立てない', async () => {
  const h = identityHarness(async () => { throw new Error('must not log in') })
  h.bindings.currentUserIdRef.current = 'new'
  await h.setup(1)
  assert.deepEqual(h.calls, [])
})

test('課金SDKの順番待ち中に取り消したアカウントは、後からログインし直さない', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const ids: string[] = []
  const h = identityHarness(async (id) => { ids.push(id) })
  h.bindings.purchasesIdentitySync = pending
  const old = h.syncPurchasesIdentity(1)
  h.bindings.user = { id: 'new' }
  h.bindings.currentUserIdRef.current = 'new'
  h.bindings.setupGenerationRef.current = 2
  const current = h.syncPurchasesIdentity(2)
  finish()
  assert.equal(await old, false)
  assert.equal(await current, true)
  assert.deepEqual(ids, ['new'])
})
