import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import * as network from '../src/utils/networkError'
import * as callbacks from '../src/utils/authCallback'
import * as secure from '../src/utils/secureTransport'

const user = { id: 'a', email: 'a@example.invalid', identities: [{ provider: 'email' }] }
const session = { user, access_token: 'a-token', refresh_token: 'a-refresh' }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function load(file: string, dependencies: (id: string) => any) {
  const module = { exports: {} as any }
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: dependencies, Error, Promise })
  return module.exports
}
function authModule(main: any, factory: () => any) {
  return load('src/services/auth.ts', id => {
    if (id.endsWith('/supabase/client')) return { supabase: main, createEphemeralAuthClient: factory }
    if (id.endsWith('/networkError')) return network
    if (id.endsWith('/authCallback')) return callbacks
    if (id.endsWith('/secureTransport')) return secure
    if (id === 'expo-auth-session') return { makeRedirectUri: ({ path }: { path: string }) => 'mydesk://' + path }
    if (id === 'expo-web-browser') return { maybeCompleteAuthSession: () => {} }
    return {}
  })
}
function harness(options: { verifiedUser?: string; onVerify?: () => void; onSnapshotUser?: () => void; reply?: any; onInvoke?: () => void } = {}) {
  let current: any = session
  const updates: any[] = []
  const logouts: string[] = []
  const invokes: any[] = []
  let counter = 0
  const main: any = {
    auth: {
      getSession: async () => ({ data: { session: current }, error: null }),
      getUser: async (token: string) => { options.onSnapshotUser?.(); return { data: { user: token.startsWith('b-') ? { ...user, id: 'b' } : user }, error: null } },
      signInWithPassword: () => { throw new Error('must not replace main session') },
      updateUser: () => { throw new Error('must not update a moving main session') },
    },
    functions: { invoke: async (_name: string, init: any) => { invokes.push(init); options.onInvoke?.(); return { data: options.reply ?? { ok: true }, error: null } } },
  }
  const api = authModule(main, () => {
    let token = 'empty'
    const index = ++counter
    return { auth: {
      signInWithPassword: async () => {
        token = 'verification-token'
        options.onVerify?.()
        return { data: { session: { ...session, access_token: token, user: { ...user, id: options.verifiedUser ?? 'a' } } }, error: null }
      },
      setSession: async (input: any) => { token = input.access_token; return { data: { session }, error: null } },
      updateUser: async (attributes: any) => { updates.push({ token, attributes, index }); return { data: { user }, error: null } },
      signOut: async ({ scope }: { scope: string }) => { assert.equal(scope, 'local'); logouts.push(token); return { error: null } },
      dispose: async () => {},
    } }
  })
  return { api, main, updates, logouts, invokes, switchUser: () => { current = { ...session, user: { ...user, id: 'b' }, access_token: 'b-token' } } }
}

test('パスワード変更は照合用セッションだけを失効し、元の本人のセッションで更新する', async () => {
  const h = harness()
  await h.api.changeAccountPassword('a', 'current', 'new-password')
  assert.equal(h.updates.length, 1)
  assert.equal(h.updates[0].token, 'a-token')
  assert.equal(h.updates[0].attributes.password, 'new-password')
  assert.equal(h.updates[0].index, 2)
  assert.deepEqual(h.logouts, ['verification-token'])
})
test('照合中に本人が切り替わったらパスワードを更新せず、照合用セッションを閉じる', async () => {
  const h: ReturnType<typeof harness> = harness({ onVerify: () => h.switchUser() })
  await assert.rejects(h.api.changeAccountPassword('a', 'current', 'new-password'), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(h.updates.length, 0)
  assert.deepEqual(h.logouts, ['verification-token'])
})
test('照合が別のアカウントを返した場合もパスワードを変更しない', async () => {
  const h = harness({ verifiedUser: 'b' })
  await assert.rejects(h.api.changeAccountPassword('a', 'current', 'new-password'), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(h.updates.length, 0)
})
test('本人確認の応答待ちにアカウントが替わったら設定セッションを渡さない', async () => {
  const h: ReturnType<typeof harness> = harness({ onSnapshotUser: () => h.switchUser() })
  await assert.rejects(h.api.authenticatedSettingsSession('a'), /AUTH_ACCOUNT_CHANGED/)
})
test('メール変更・退会準備は確認対象が替わると実行しない', async () => {
  const h = harness()
  h.switchUser()
  await assert.rejects(h.api.requestEmailChange('new@example.invalid', 'a'), /AUTH_ACCOUNT_CHANGED/)
  await assert.rejects(h.api.prepareAccountDeletion('a'), /AUTH_ACCOUNT_CHANGED/)
  await assert.rejects(h.api.reauthenticateForDeletion(async () => 'password', 'a'), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(h.updates.length, 0)
})
test('メール変更は本人のセッションに固定し、公開設定もそのトークンで送る', async () => {
  const h = harness()
  await h.api.requestEmailChange('new@example.invalid', 'a')
  assert.equal(h.updates[0].token, 'a-token')
  const headers: string[] = []
  h.main.rpc = () => ({ setHeader: (_name: string, value: string) => { headers.push(value); h.switchUser(); return Promise.resolve({ data: false, error: null }) } })
  const profiles = load('src/services/profiles.ts', id => id.endsWith('/auth') ? h.api : { supabase: h.main })
  assert.equal(await profiles.setProfileDiscoverable(false, 'a'), false)
  assert.deepEqual(headers, ['Bearer a-token'])
})
test('退会要求は本人のトークンを固定し、別人の再認証トークンや不完全な成功返信を拒否する', async () => {
  const h: ReturnType<typeof harness> = harness({ onInvoke: () => h.switchUser() })
  await h.api.deleteAccount(undefined, undefined, 'a')
  assert.equal(h.invokes[0].headers.Authorization, 'Bearer a-token')
  const wrong = harness()
  await assert.rejects(wrong.api.deleteAccount(undefined, 'b-token', 'a'), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(wrong.invokes.length, 0)
  const incomplete = harness({ reply: {} })
  await assert.rejects(incomplete.api.deleteAccount(undefined, undefined, 'a'), /ACCOUNT_DELETION_UNCONFIRMED/)
})
test('公開範囲の返信が不完全なら変更を成功として返さない', async () => {
  const h = harness()
  h.main.rpc = () => ({ setHeader: () => Promise.resolve({ data: null, error: null }) })
  const profiles = load('src/services/profiles.ts', id => id.endsWith('/auth') ? h.api : { supabase: h.main })
  await assert.rejects(profiles.setProfileDiscoverable(false, 'a'), /PROFILE_SETTING_UNCONFIRMED/)
})

test('実際の認証SDKでも再認証と更新が元のセッションを切り替えず、照合用トークンだけをログアウトする', async () => {
  const jwt = (sid: string) => {
    const encode = (value: any) => Buffer.from(JSON.stringify(value)).toString('base64url')
    return encode({ alg: 'HS256' }) + '.' + encode({ sub: 'a', exp: Math.floor(Date.now() / 1000) + 3600, session_id: sid }) + '.fixture'
  }
  const original = jwt('original')
  const verification = jwt('verification')
  const writes: string[] = []
  const expired: string[] = []
  const transport: typeof fetch = async (input, init) => {
    const url = String(input)
    const token = new Headers(init?.headers).get('Authorization')!
    if (url.includes('/token?')) return Response.json({ user, access_token: verification, refresh_token: 'v-refresh', token_type: 'bearer', expires_in: 3600 })
    if (url.endsWith('/user') && init?.method === 'PUT') { assert.equal(JSON.parse(init!.body as string).current_password, 'current'); writes.push(token); return Response.json(user) }
    if (url.includes('/logout')) { expired.push(token); return new Response(null, { status: 204 }) }
    if (url.endsWith('/user')) return Response.json(user)
    throw new Error('Unexpected mock request: ' + url)
  }
  const make = () => {
    const storage = new Map<string, string>()
    return createClient('https://fixture.supabase.co', 'fixture-key', {
      global: { fetch: transport },
      auth: { storage: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value) }, removeItem: async key => { storage.delete(key) } },
        storageKey: 'fixture', autoRefreshToken: false, persistSession: true, detectSessionInUrl: false },
    })
  }
  const main = make()
  await main.auth.setSession({ access_token: original, refresh_token: 'a-refresh' })
  const events: string[] = []
  const { data: { subscription } } = main.auth.onAuthStateChange(event => events.push(event))
  await flush()
  events.length = 0
  try {
    const api = authModule(main, make)
    await api.changeAccountPassword('a', 'current', 'new-password')
    assert.equal((await main.auth.getSession()).data.session?.access_token, original)
    assert.deepEqual(writes, ['Bearer ' + original])
    assert.deepEqual(expired, ['Bearer ' + verification])
    assert.equal(events.includes('SIGNED_IN'), false)
    assert.equal(events.includes('SIGNED_OUT'), false)
  } finally { subscription.unsubscribe(); await main.auth.dispose() }
})
function handler(name: string, bindings: Record<string, any>) {
  const file = 'src/screens/SettingsScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression!: ts.Node
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) expression = node.initializer
    ts.forEachChild(node, walk)
  }
  walk(source)
  return runInNewContext(ts.transpileModule('(' + expression.getText(source) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { Error, ...bindings })
}

test('退会の確認前・再認証待ち・完了待ちに本人が替わっても新しい端末データを消さない', async () => {
  for (const phase of ['before', 'reauth', 'deletion']) {
    const settingsUserIdRef = { current: 'a' }
    const calls: string[] = []
    const alerts: any[][] = []
    let resolve!: (value: string) => void
    const wait = new Promise<string>(done => { resolve = done })
    const run = handler('handleDeleteAccount', {
      user, settingsUserIdRef, accountDeletionInFlightRef: { current: false }, language: 'ja',
      Alert: { alert: (...args: any[]) => alerts.push(args) }, setDeletingAccount: () => {},
      prepareAccountDeletion: () => { calls.push('prepare'); return phase === 'reauth' ? wait : Promise.resolve('apple-code') },
      deleteAccount: async (_apple: string, _token: string, expected: string) => { calls.push('delete:' + expected); if (phase === 'deletion') await wait },
      deleteAllPublishedData: async () => { calls.push('predelete') },
      AsyncStorage: { clear: async () => { calls.push('clear') } },
      finishAccountDeletion: async () => { calls.push('finish') },
      navigation: { getParent: () => null }, localizedErrorMessage: () => 'failed',
    })
    run()
    alerts[0][2][1].onPress()
    if (phase === 'before') settingsUserIdRef.current = 'b'
    const pending = alerts[1][2][1].onPress()
    await flush()
    settingsUserIdRef.current = 'b'
    resolve('apple-code')
    await pending
    assert.equal(calls.includes('predelete'), false)
    assert.equal(calls.includes('clear'), false)
    assert.equal(calls.includes('finish'), false)
    assert.equal(calls.includes('delete:a'), phase === 'deletion')
  }
})
test('通知設定の遅い失敗で次のアカウントの設定を巻き戻さない', async () => {
  const settingsUserIdRef = { current: 'a' }
  const values: any[] = []
  let reject!: (error: Error) => void
  const run = handler('changeNotifPref', {
    user, settingsUserIdRef, notifPrefsUserIdRef: { current: 'a' },
    notifPrefs: { claps: true, followUpdates: true }, notificationSaveInFlightRef: { current: false },
    setNotifPrefs: (value: any) => values.push(value), setSavingNotif: () => {},
    setNotificationPrefs: () => new Promise((_resolve, fail) => { reject = fail }),
    Alert: { alert: () => { throw new Error('old alert') } }, language: 'ja', localizedErrorMessage: () => 'failed',
  })
  const pending = run('claps', false)
  settingsUserIdRef.current = 'b'
  reject(new Error('offline'))
  await pending
  assert.equal(values.length, 1)
})
test('公開設定の遅い完了で次のアカウントのプロフィールを取り直さない', async () => {
  const settingsUserIdRef = { current: 'a' }
  let finish!: () => void
  let refreshed = 0
  const run = handler('changeDiscoverable', {
    user, settingsUserIdRef, discoverableUserIdRef: { current: 'a' }, discoverableSaveInFlightRef: { current: false },
    discoverable: true, setDiscoverable: () => {}, setSavingDiscoverable: () => {},
    setProfileDiscoverable: () => new Promise<void>(done => { finish = done }),
    refreshProfile: () => { refreshed++; return Promise.resolve() },
    Alert: { alert: () => {} }, language: 'ja', localizedErrorMessage: () => 'failed',
  })
  const pending = run(false)
  settingsUserIdRef.current = 'b'
  finish()
  await pending
  assert.equal(refreshed, 0)
})
