import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import { localizedErrorMessage } from '../src/utils/localizedError'
import * as callbackUtils from '../src/utils/authCallback'
import * as secureTransport from '../src/utils/secureTransport'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function load(file: string, dependencies: (id: string) => unknown, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, Promise, Error, require: dependencies, ...globals })
  return module.exports
}

function timers() {
  const pending = new Map<number, { run: () => void; ms: number }>()
  let id = 0
  const globals = {
    setTimeout: (run: () => void, ms: number) => { pending.set(++id, { run, ms }); return id },
    clearTimeout: (key: number) => { pending.delete(key) },
  }
  return {
    globals, pending,
    expire: () => { const [key, timer] = [...pending.entries()][0]; pending.delete(key); timer.run() },
  }
}

function authService(options: { remote?: () => Promise<any>; remove?: () => Promise<void>; oauth?: () => Promise<any>; exchange?: () => Promise<any>; apple?: () => Promise<any>; browser?: () => Promise<any> } = {}) {
  const time = timers()
  const network = load('src/utils/networkError.ts', () => ({}), time.globals)
  const saved = new Set(['session', 'session-code-verifier'])
  const calls: string[] = []
  const service = load('src/services/auth.ts', id => {
    if (id.endsWith('/supabase/client')) return { supabaseAuthStorageKey: 'session', supabase: { auth: {
      signOut: async ({ scope }: { scope: string }) => {
        assert.equal(scope, 'local')
        calls.push(saved.has('session') ? 'remote' : 'local')
        return saved.has('session') ? options.remote?.() ?? { error: null } : { error: null }
      },
      signInWithOAuth: options.oauth ?? (async () => ({ data: { url: 'https://provider.test' }, error: null })),
      exchangeCodeForSession: options.exchange ?? (async () => ({ data: { session: {} }, error: null })),
      signInWithIdToken: options.apple ?? (async () => ({ data: { session: {} }, error: null })),
    } } }
    if (id.endsWith('/sessionStorage')) return { sessionStorage: { removeItem: async (key: string) => { await options.remove?.(); saved.delete(key); calls.push('remove:' + key) } } }
    if (id.endsWith('/accountDataOwner')) return { markSignInPending: async () => { calls.push('pending') } }
    if (id.endsWith('/publicNickname')) return { seedPublicNickname: async () => {} }
    if (id.endsWith('/networkError')) return network
    if (id.endsWith('/authCallback')) return callbackUtils
    if (id.endsWith('/secureTransport')) return secureTransport
    if (id === 'expo-web-browser') return { maybeCompleteAuthSession: () => {}, openAuthSessionAsync: options.browser ?? (async () => ({ type: 'success', url: 'mydesk://auth/callback?code=code' })) }
    if (id === 'expo-auth-session') return { makeRedirectUri: ({ path }: { path: string }) => `mydesk://${path}` }
    if (id === 'expo-crypto') return { randomUUID: () => 'nonce', digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'sha256' } }
    if (id === 'expo-apple-authentication') return { signInAsync: async () => ({ identityToken: 'token' }), AppleAuthenticationScope: {} }
    throw new Error(id)
  }, time.globals)
  return { service, time, calls, saved }
}

test('ログアウトの応答エラー・通信例外・無応答でもローカルセッションを消し、同じ失効通信を繰り返さない', async () => {
  for (const kind of ['response', 'reject', 'timeout']) {
    const h = authService({ remote: () => kind === 'response' ? Promise.resolve({ error: new Error('offline') })
      : kind === 'reject' ? Promise.reject(new Error('offline')) : new Promise(() => {}) })
    const result = h.service.signOut()
    if (kind === 'timeout') h.time.expire()
    await result
    assert.equal(h.saved.size, 0)
    assert.deepEqual(h.calls, ['remote', 'remove:session', 'remove:session-code-verifier', 'local'])
    assert.equal(h.time.pending.size, 0)
  }
})

test('端末のセッション削除に失敗したらログアウトを成功扱いにせず、次の操作で再試行できる', async () => {
  let fail = true
  const h = authService({ remote: async () => ({ error: new Error('offline') }), remove: async () => { if (fail) throw new Error('secure storage failed') } })
  await assert.rejects(h.service.signOut(), /secure storage failed/)
  assert.equal(h.saved.size, 2)
  fail = false
  await h.service.signOut()
  assert.equal(h.saved.size, 0)
})

test('Google・Appleの通信が返らない場合は期限で失敗し、次の認証を開始できる', async () => {
  for (const phase of ['oauth', 'exchange', 'apple'] as const) {
    const h = authService({ [phase]: () => new Promise(() => {}) })
    const result = phase === 'apple' ? h.service.signInWithApple() : h.service.signInWithGoogle()
    const rejected = assert.rejects(result, /timed out/)
    await flush()
    assert.equal(h.time.pending.size, 1)
    assert.equal([...h.time.pending.values()][0].ms, 20_000)
    h.time.expire()
    await rejected
    assert.equal(h.time.pending.size, 0)
  }
})

test('Googleの本人操作を待つ間は通信タイマーを止め、キャンセル時にはセッション確立の印を立てない', async () => {
  const browser = deferred<any>()
  const h = authService({ browser: () => browser.promise })
  const result = h.service.signInWithGoogle()
  await flush()
  assert.equal(h.time.pending.size, 0)
  browser.resolve({ type: 'cancel' })
  assert.equal(await result, null)
  assert.equal(h.calls.includes('pending'), false)
})

function provider(options: { session?: () => Promise<any>; profile?: (id: string) => Promise<any>; snapshot?: () => Promise<string>; push?: () => Promise<void>; clearSession?: () => Promise<void>; validate?: (session: any) => Promise<void> } = {}) {
  const slots: any[] = []
  let cursor = 0
  const queued: (() => void)[] = []
  const memo = (create: () => any, deps: any[]) => {
    const index = cursor++
    if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) slots[index] = { value: create(), deps }
    return slots[index].value
  }
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef: (current: unknown) => { const index = cursor++; return slots[index] ??= { current } },
    useCallback: (run: unknown, deps: any[]) => memo(() => run, deps),
    useEffect: (run: () => any, deps: any[]) => {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      slots[index] = { deps }
      queued.push(() => { previous?.cleanup?.(); slots[index].cleanup = run() })
    },
  }
  const time = timers()
  const network = load('src/utils/networkError.ts', () => ({}), time.globals)
  const store = new Map<string, string>()
  const calls: string[] = []
  let emit!: (event: string, session: any) => void
  let foreground = (_state: string) => {}
  const service = load('src/context/AuthContext.tsx', id => {
    if (id.endsWith('/deskDeletionCleanup')) return { resumePendingDeskCleanups: async () => {} }
    if (id === 'react') return react
    if (id === 'react-native') return { AppState: { currentState: 'active', addEventListener: (_event: string, run: (state: string) => void) => { foreground = run; return { remove: () => {} } } } }
    if (id.endsWith('/accountAccess')) return { validateAccountAccess: options.validate ?? (async () => {}), isAccountAccessRevoked: (error: any) => ['user_banned', 'user_not_found', 'session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used'].includes(error?.code) || (error?.code === 'PT401' && error?.message === 'ACCOUNT_ACCESS_REVOKED') }
    if (id === 'react/jsx-runtime') return { jsx: (_type: unknown, props: any) => props.value }
    if (id === '@react-native-async-storage/async-storage') return { default: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value) }, removeItem: async (key: string) => { store.delete(key) },
    } }
    if (id.endsWith('/supabase/client')) return { supabase: { auth: {
      getSession: options.session ?? (async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: (run: typeof emit) => { emit = run; return { data: { subscription: { unsubscribe: () => {} } } } },
    } } }
    if (id.endsWith('/auth')) return { signOut: async () => { calls.push('signOut'); emit('SIGNED_OUT', null) }, clearLocalSession: async () => { calls.push('clearSession'); emit('SIGNED_OUT', null); await options.clearSession?.() } }
    if (id.endsWith('/passkeyService')) return { signInWithPasskey: async () => { calls.push('passkeySignIn') } }
    if (id.endsWith('/profiles')) return { getProfile: async (key: string) => { calls.push('profile:' + key); return options.profile?.(key) ?? { id: key, tier: 'free', display_name: key } } }
    if (id.endsWith('/analytics')) return { analytics: { track: () => {}, error: () => {}, setContext: () => {}, reset: () => {} }, EVENTS: {}, initAnalytics: async () => {}, trackAppOpened: async () => {} }
    if (id.endsWith('/clearLocalUserData')) return { clearLocalUserData: async () => { calls.push('clearData') } }
    if (id.endsWith('/publicNickname')) return { seedPublicNickname: async (name: string) => { calls.push('nickname:' + name) } }
    if (id.endsWith('/lastAuthMethod')) return { rememberAuthMethod: async () => {} }
    if (id.endsWith('/backupService')) return { saveAccountSnapshotNow: options.snapshot ?? (async () => 'done') }
    if (id.endsWith('/pushNotifications')) return { unregisterPushToken: options.push ?? (async () => {}) }
    if (id.endsWith('/networkError')) return network
    if (id.endsWith('/authCallback')) return callbackUtils
    if (id.endsWith('/secureTransport')) return secureTransport
    throw new Error(id)
  }, { ...time.globals, __DEV__: false })
  return {
    calls, store, time,
    emit: (id: string | null, event = 'SIGNED_IN') => emit(event, id ? { user: { id }, access_token: id } : null),
    foreground: () => foreground('active'),
    render: () => { cursor = 0; const result = service.AuthProvider({ children: null }); queued.splice(0).forEach(run => run()); return result },
    unmount: () => { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('ログアウトの控え取得中は二重ログアウト・削除終了・再認証を始めない', async () => {
  const snapshot = deferred<string>()
  let saves = 0
  const h = provider({ snapshot: () => { saves++; return snapshot.promise } })
  h.render(); await flush()
  h.emit('me'); await flush()
  const auth = h.render()
  const pending = auth.logOut()
  for (const run of [
    () => auth.logOut(), () => auth.finishAccountDeletion(), () => auth.signOutKeepingLocalData(),
    () => auth.signIn('mail', 'pass'), () => auth.signUp('mail', 'pass'),
    () => auth.signInGoogle(), () => auth.signInApple(), () => auth.signInPasskey(), () => auth.skipAuth(),
  ]) await assert.rejects(run(), /AUTH_OPERATION_IN_PROGRESS/)
  assert.equal(saves, 1)
  snapshot.resolve('done')
  await pending
  assert.equal(h.calls.filter(value => value === 'signOut').length, 1)
  assert.equal(h.calls.filter(value => value === 'clearData').length, 1)
  h.unmount()
})

test('ログアウトの控え取得に失敗しても処理ロックを解き、再試行できる', async () => {
  let saves = 0
  const h = provider({ snapshot: async () => ++saves === 1 ? 'failed' : 'done' })
  h.render(); await flush()
  h.emit('me'); await flush()
  const auth = h.render()
  await assert.rejects(auth.logOut(), /LOGOUT_BACKUP_FAILED/)
  await auth.logOut()
  assert.equal(saves, 2)
  assert.equal(h.calls.filter(value => value === 'signOut').length, 1)
  h.unmount()
})

test('切り替え直後に前のプロフィールを残さず、古いプロフィール更新を新しい本人へ適用しない', async () => {
  const next = deferred<any>()
  const h = provider({ profile: async id => id === 'new' ? next.promise : { id, tier: 'pro', display_name: id } })
  h.render(); await flush()
  h.emit('old'); await flush()
  const old = h.render()
  assert.equal(old.profile.id, 'old')
  h.emit('new')
  assert.equal(h.render().profile, null)
  await old.refreshProfile()
  assert.equal(h.calls.filter(value => value === 'profile:old').length, 1)
  next.resolve({ id: 'new', tier: 'free', display_name: 'new' })
  await flush()
  assert.equal(h.render().profile.id, 'new')
})

test('同じ本人のトークン更新中はプロフィールを維持し、古い取得結果やログアウト後の結果は捨てる', async () => {
  const late = deferred<any>()
  let reads = 0
  const h = provider({ profile: async id => ++reads === 1 ? { id, tier: 'pro', display_name: id } : late.promise })
  h.render(); await flush()
  h.emit('me'); await flush()
  h.emit('me', 'TOKEN_REFRESHED')
  assert.equal(h.render().profile.id, 'me')
  h.emit(null, 'SIGNED_OUT')
  late.resolve({ id: 'me', tier: 'pro', display_name: 'late' })
  await flush()
  assert.equal(h.render().profile, null)
  assert.equal(h.calls.includes('nickname:late'), false)
})

test('古い起動時セッションと画面を閉じた後の応答は、認証状態や保存済みの印を上書きしない', async () => {
  for (const unmount of [false, true]) {
    const late = deferred<any>()
    const h = provider({ session: () => late.promise })
    h.render()
    if (unmount) h.unmount()
    else h.emit('current')
    late.resolve({ data: { session: { user: { id: 'old' } } }, error: null })
    await flush()
    assert.equal(h.calls.includes('profile:old'), false)
    assert.equal(h.store.get('@auth_had_session'), unmount ? undefined : '1')
    if (!unmount) assert.equal(h.render().user.id, 'current')
  }
})

test('古いアカウントのログアウト・削除完了コールバックは、次のアカウントのセッションやデータを消さない', async () => {
  const h = provider()
  h.render(); await flush()
  h.emit('old'); await flush()
  const old = h.render()
  h.emit('new'); await flush()
  for (const operation of [old.logOut, old.signOutKeepingLocalData, old.finishAccountDeletion]) await assert.rejects(operation(), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(h.calls.includes('signOut'), false)
  assert.equal(h.calls.includes('clearSession'), false)
  assert.equal(h.calls.includes('clearData'), false)
  assert.equal(h.render().user.id, 'new')
})

test('ログアウトの控えを保存中に本人が替わったら、その後のセッション削除や端末消去を始めない', async () => {
  const snapshot = deferred<string>()
  const h = provider({ snapshot: () => snapshot.promise })
  h.render(); await flush()
  h.emit('old'); await flush()
  const result = h.render().logOut()
  const rejected = assert.rejects(result, /AUTH_ACCOUNT_CHANGED/)
  h.emit('new')
  snapshot.resolve('done')
  await rejected
  assert.equal(h.calls.includes('signOut'), false)
  assert.equal(h.calls.includes('clearData'), false)
})

test('アカウント削除の完了前にセッションが失効しても、新しい本人がいなければ後処理を完了する', async () => {
  const h = provider()
  h.render(); await flush()
  h.emit('old'); await flush()
  const finish = h.render().finishAccountDeletion
  h.emit(null, 'SIGNED_OUT')
  await finish()
  assert.ok(h.calls.includes('clearSession'))
  assert.ok(h.calls.includes('clearData'))
  assert.equal(h.render().user, null)
  assert.equal(h.render().loading, false)
})

test('通知登録の解除を待つ間に本人が替わった場合も、新しいアカウントをログアウトさせない', async () => {
  for (const keepingData of [false, true]) {
    const push = deferred<void>()
    const h = provider({ push: () => push.promise })
    h.render(); await flush()
    h.emit('old'); await flush()
    const old = h.render()
    const result = keepingData ? old.signOutKeepingLocalData() : old.logOut()
    const rejected = assert.rejects(result, /AUTH_ACCOUNT_CHANGED/)
    await flush()
    h.emit('new')
    push.resolve()
    await rejected
    assert.equal(h.calls.includes('signOut'), false)
    assert.equal(h.calls.includes('clearData'), false)
    assert.equal(h.render().user.id, 'new')
    assert.equal(h.render().loading, false)
  }
})

test('実際の認証SDKでも、失効通信の失敗後は端末だけログアウトしSIGNED_OUTを通知する', async context => {
  context.mock.method(console, 'error', () => {})
  const key = 'test-auth-token'
  const saved = new Map<string, string>([[key, JSON.stringify({
    access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'fixture-user' },
  })], [key + '-code-verifier', 'fixture-verifier']])
  const storage = { getItem: async (name: string) => saved.get(name) ?? null, setItem: async (name: string, value: string) => { saved.set(name, value) }, removeItem: async (name: string) => { saved.delete(name) } }
  let requests = 0
  const client = createClient('https://fixture.supabase.co', 'fixture-key', {
    auth: { storage, storageKey: key, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    global: { fetch: async () => { requests++; throw new Error('offline') } },
  })
  const events: string[] = []
  const { data: { subscription } } = client.auth.onAuthStateChange(event => { events.push(event) })
  assert.equal((await client.auth.getSession()).data.session?.user.id, 'fixture-user')
  const time = timers()
  const network = load('src/utils/networkError.ts', () => ({}), time.globals)
  const service = load('src/services/auth.ts', id => {
    if (id.endsWith('/supabase/client')) return { supabase: client, supabaseAuthStorageKey: key }
    if (id.endsWith('/sessionStorage')) return { sessionStorage: storage }
    if (id.endsWith('/networkError')) return network
    if (id.endsWith('/authCallback')) return callbackUtils
    if (id.endsWith('/secureTransport')) return secureTransport
    if (id === 'expo-web-browser') return { maybeCompleteAuthSession: () => {} }
    return {}
  }, time.globals)
  try {
    await service.signOut()
    assert.equal((await client.auth.getSession()).data.session, null)
    assert.equal(saved.has(key), false)
    assert.equal(saved.has(key + '-code-verifier'), false)
    assert.equal(requests, 1)
    assert.ok(events.includes('SIGNED_OUT'))
    assert.equal(time.pending.size, 0)
  } finally {
    subscription.unsubscribe()
  }
})

test('認証タイムアウトとアカウント変更のエラーは、表示言語に合わせた対処案内になる', () => {
  assert.equal(localizedErrorMessage(new Error('operation timed out after 20000ms'), 'ja'), '通信環境を確認して、もう一度お試しください。')
  assert.match(localizedErrorMessage(new Error('AUTH_ACCOUNT_CHANGED'), 'ja'), /アカウントが切り替わりました/)
  assert.match(localizedErrorMessage(new Error('AUTH_ACCOUNT_CHANGED'), 'en'), /account changed/)
})

test('Web・モバイルで認証トークンの削除に失敗した場合は失敗を返し、成功した再試行でセッションを消す', async () => {
  for (const platform of ['web', 'ios', 'android']) {
    const store = new Map([['session', 'saved-token']])
    let fail = true
    const remove = async (key: string) => { if (fail) throw new Error('storage unavailable'); store.delete(key) }
    const service = load('src/supabase/sessionStorage.ts', id => {
      if (id.endsWith('/networkError')) return { STORAGE_TIMEOUT_MS: 5000, withTimeout: (work: unknown) => work }
      if (id === 'react-native') return { Platform: { OS: platform } }
      if (id === 'expo-secure-store') return { getItemAsync: async (key: string) => store.get(key) ?? null, deleteItemAsync: remove }
      if (id === '@react-native-async-storage/async-storage') return { default: { removeItem: platform === 'web' ? remove : async () => {}, getItem: async () => null } }
      throw new Error(id)
    })
    await assert.rejects(service.sessionStorage.removeItem('session'), /storage unavailable/)
    assert.equal(store.has('session'), true)
    fail = false
    await service.sessionStorage.removeItem('session')
    assert.equal(await service.sessionStorage.getItem('session'), null)
  }
})

test('認証トークンの読み込み停止で待機を解除し、期限後の古いトークンを書き戻さない', async () => {
  for (const platform of ['web', 'ios', 'android']) {
    const time = timers()
    const network = load('src/utils/networkError.ts', () => ({}), time.globals)
    const old = deferred<string | null>()
    let writes = 0
    const service = load('src/supabase/sessionStorage.ts', id => {
      if (id === 'react-native') return { Platform: { OS: platform } }
      if (id.endsWith('/networkError')) return network
    if (id.endsWith('/authCallback')) return callbackUtils
    if (id.endsWith('/secureTransport')) return secureTransport
      if (id === 'expo-secure-store') return { getItemAsync: () => old.promise, setItemAsync: async () => { writes++ }, deleteItemAsync: async () => { writes++ } }
      if (id === '@react-native-async-storage/async-storage') return { default: {
        getItem: () => platform === 'web' ? old.promise : Promise.resolve(null),
        setItem: async () => { writes++ }, removeItem: async () => { writes++ },
      } }
      throw new Error(id)
    })
    const failed = assert.rejects(service.sessionStorage.getItem('session'), platform === 'web' ? /timed out/ : /unavailable/)
    time.expire()
    await failed
    old.resolve('old-token')
    await flush()
    assert.equal(writes, 0)
    assert.equal(time.pending.size, 0)
  }
})

function loginExpression(choose: (node: ts.Node) => ts.Expression | undefined, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile('LoginScreen.tsx', readFileSync('src/screens/LoginScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => { expression ??= choose(node); if (!expression) ts.forEachChild(node, visit) }
  visit(source)
  assert.ok(expression)
  return runInNewContext(ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bindings) as (...args: any[]) => any
}

test('メールと外部認証を続けて押しても別の認証を同時開始せず、失敗後には次の方法で再試行できる', async () => {
  for (const first of ['email', 'google']) {
    const gate = deferred<boolean>()
    const calls: string[] = []
    let finished = 0
    const submit = { current: false }
    const social = { current: false }
    const bindings = {
      email: 'test@example.test', password: 'password', mode: 'signin', lang: 'ja',
      submitInFlightRef: submit, socialInFlightRef: social, skipInFlightRef: { current: false },
      setError: () => {}, setInfo: () => {}, setLoading: () => {}, setSocialLoading: () => {}, finishLogin: () => { finished++ },
      analytics: { track: () => {} }, EVENTS: {}, errorProperties: () => ({}), localizedErrorMessage,
      QUICK_TIMEOUT_MS: 20_000, withTimeout: (work: unknown) => work,
      signIn: () => { calls.push('email'); return calls.length === 1 ? gate.promise : Promise.resolve(true) },
      signInGoogle: () => { calls.push('google'); return calls.length === 1 ? gate.promise : Promise.resolve(true) },
    }
    const find = (name: string) => (node: ts.Node) => ts.isVariableDeclaration(node) && node.name.getText() === name ? node.initializer : undefined
    const email = loginExpression(find('handleSubmit'), bindings)
    const google = loginExpression(find('handleSocialSignIn'), bindings)
    const pending = first === 'email' ? email() : google('google')
    await (first === 'email' ? google('google') : email())
    assert.deepEqual(calls, [first])
    gate.reject(new Error('Invalid login credentials'))
    await pending
    assert.equal(finished, 0)
    assert.equal(submit.current, false)
    assert.equal(social.current, false)
    await (first === 'email' ? google('google') : email())
    assert.equal(calls.length, 2)
    assert.equal(finished, 1)
  }
})

test('Apple認証の利用可否確認が失敗してもメールとGoogle認証を利用できる', async () => {
  const available: boolean[] = []
  const run = loginExpression(node => ts.isCallExpression(node) && node.expression.getText() === 'useEffect'
    && node.arguments[0]?.getText().includes('isAvailableAsync') ? node.arguments[0] : undefined, {
    Platform: { OS: 'ios' }, AppleAuthentication: { isAvailableAsync: async () => { throw new Error('unavailable') } },
    setAppleAvailable: (value: boolean) => { available.push(value) },
  })
  run()
  await flush()
  assert.deepEqual(available, [false])
})
test('不正な認証戻り先と重複コードではセッション交換や本人データの準備を開始しない', async () => {
  for (const url of [
    'https://evil.invalid/auth/callback?code=abc',
    'mydesk://auth/callback/extra?code=abc',
    'mydesk://auth/callback?code=a&code=b',
    'mydesk://auth/callback?code=a&%63ode=b',
    'mydesk://auth/callback?code=%C0',
  ]) {
    let exchanges = 0
    const h = authService({ browser: async () => ({ type: 'success', url }), exchange: async () => { exchanges++; return { data: {}, error: null } } })
    await h.service.signInWithGoogle().catch(() => null)
    assert.equal(exchanges, 0, url)
    assert.equal(h.calls.includes('pending'), false)
  }
})
test('認証の開始URLがHTTPならブラウザを開かない', async () => {
  let browserCalls = 0
  const h = authService({
    oauth: async () => ({ data: { url: 'http://provider.test/' }, error: null }),
    browser: async () => { browserCalls++; return { type: 'cancel' } },
  })
  await assert.rejects(h.service.signInWithGoogle(), /HTTPS/)
  assert.equal(browserCalls, 0)
})
test('復旧リンクは正確な戻り先のPKCEコードだけを一度復号して交換する', async () => {
  let exchanges = 0
  const h = authService({ exchange: async () => { exchanges++; return { error: null } } })
  for (const url of [
    'mydesk://desk/other?next=auth/reset-password&code=abc',
    'https://evil.invalid/auth/reset-password?code=abc',
    'mydesk://auth/reset-password?code=a&code=b',
    'mydesk://auth/reset-password#access_token=attacker&refresh_token=attacker',
  ]) assert.equal(await h.service.completePasswordRecovery(url), false, url)
  assert.equal(exchanges, 0)
  assert.equal(await h.service.completePasswordRecovery('mydesk://auth/reset-password?code=abc'), true)
  assert.equal(exchanges, 1)
  assert.deepEqual(h.calls, ['pending'])
})
test('退会後のセッション消去待ちに新しい本人が現れたら端末データの消去を止める', async () => {
  const clearing = deferred<void>()
  const h = provider({ clearSession: () => clearing.promise })
  h.render(); await flush()
  h.emit('old'); await flush()
  const rejected = assert.rejects(h.render().finishAccountDeletion(), /AUTH_ACCOUNT_CHANGED/)
  await flush()
  h.emit('new'); await flush()
  clearing.resolve()
  await rejected
  assert.equal(h.calls.includes('clearData'), false)
  assert.equal(h.render().user.id, 'new')
})

test('削除・BAN・セッション失効が確定したら認証だけ閉じ、端末のデータは消さない', async () => {
  for (const code of ['user_not_found', 'user_banned', 'session_not_found', 'PT401']) {
    const h = provider({ validate: async () => { throw { code, message: 'ACCOUNT_ACCESS_REVOKED' } } })
    h.render(); await flush()
    h.emit('me')
    h.render(); await flush()
    const auth = h.render()
    assert.equal(auth.session, null)
    assert.equal(auth.sessionLikely, false)
    assert.equal(h.calls.filter(value => value === 'clearSession').length, 1)
    assert.equal(h.calls.includes('clearData'), false)
    assert.equal(h.calls.includes('signOut'), false)
    assert.equal(h.store.get('@auth_had_session'), '0')
    await auth.skipAuth()
    h.unmount()
  }
})

test('通信切断・タイムアウト・サーバー障害をBAN扱いせず、画面復帰時に再確認する', async () => {
  for (const error of [new Error('offline'), { code: 'unexpected_failure' }, { code: 'PGRST202' }]) {
    let validations = 0
    const h = provider({ validate: async () => { validations++; throw error } })
    h.render(); await flush()
    h.emit('me')
    h.render(); await flush()
    assert.equal(h.render().user.id, 'me')
    assert.equal(h.calls.includes('clearSession'), false)
    h.foreground(); await flush()
    assert.equal(validations, 2)
    h.unmount()
  }
})

test('古いアカウントの失効確認が遅れても、切り替え先や再ログイン済みのセッションを消さない', async () => {
  const pending = deferred<void>()
  const h = provider({ validate: session => session.user.id === 'old' ? pending.promise : Promise.resolve() })
  h.render(); await flush()
  h.emit('old'); h.render()
  h.emit('new'); h.render()
  pending.reject(Object.assign(new Error('removed'), { code: 'user_not_found' }))
  await flush()
  assert.equal(h.render().user.id, 'new')
  assert.equal(h.calls.includes('clearSession'), false)
  h.unmount()
})

test('起動時の認証失効エラーで、前回ログイン済みの印からログイン画面を飛ばさない', async () => {
  const h = provider({ session: async () => { throw { code: 'user_banned' } } })
  h.store.set('@auth_had_session', '1')
  h.render(); await flush()
  assert.equal(h.render().sessionLikely, false)
  assert.equal(h.store.get('@auth_had_session'), '0')
  h.unmount()
})
