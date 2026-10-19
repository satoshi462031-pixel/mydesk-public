import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PLAN_LIMITS } from '../src/constants/plans'

function callback(file: string, name: string): string {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      found = node.initializer.arguments[0]
    }
    if (name === 'reconcile' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('reconcileAccountData')) {
      found = node.arguments[0]
    }
    if (name === 'autoBackup' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('runAutoBackupIfDue')) {
      found = node.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found)
  return found.getText(source)
}

function evaluate(expression: string, bindings: Record<string, any>) {
  const code = ts.transpileModule(`module.exports = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: undefined as any }
  runInNewContext(code, { module, ...bindings })
  return module.exports
}

function logout(result = 'done', lifecycle: { clear?: () => Promise<void>; ending?: (value: boolean) => void; signOut?: () => Promise<void> } = {}) {
  const calls: string[] = []
  const run = evaluate(callback('src/context/AuthContext.tsx', 'logOut'), {
    session: { user: { id: 'free-user' } }, profile: { tier: 'free' },
    saveAccountSnapshotNow: async () => { calls.push('backup'); return result },
    signOut: async () => { calls.push('signOut'); await lifecycle.signOut?.() },
    unregisterPushToken: async () => {}, resumePendingDeskCleanups: async () => { calls.push('deskCleanup') }, withTimeout: (promise: Promise<any>) => promise,
    AsyncStorage: { setItem: async () => {}, removeItem: async () => {} },
    analytics: { error: () => {} },
    setIsEndingSession: lifecycle.ending ?? (() => {}), setAuthSkipped: () => {}, setSession: () => {}, setSessionLikely: () => {}, setProfile: () => {},
    profileRequestId: { current: 0 }, authenticatedSession: { current: true },
    currentUserIdRef: { current: 'free-user' },
    sessionEndInFlightRef: { current: false },
    AUTH_SKIPPED_KEY: 'skip', HAD_SESSION_KEY: 'had',
    clearLocalUserData: async () => { calls.push('clear'); await lifecycle.clear?.() },
  }) as (options?: { discardUnsaved: boolean }) => Promise<void>
  return { run, calls }
}

test('Freeでも控えを保存してからログアウトし、端末のデータを消す', async () => {
  const harness = logout()
  await harness.run()
  assert.deepEqual(harness.calls, ['backup', 'deskCleanup', 'signOut', 'clear'])
})

test('Freeの控えが取れなければログアウトもデータ削除も始めない', async () => {
  const harness = logout('not-synced')
  await assert.rejects(harness.run(), (error: any) => error.logoutBackup === 'not-synced')
  assert.deepEqual(harness.calls, ['backup'])
})

test('本人が保存せずにログアウトを選んだ場合だけ控えを省略する', async () => {
  const harness = logout()
  await harness.run({ discardUnsaved: true })
  assert.deepEqual(harness.calls, ['deskCleanup', 'signOut', 'clear'])
})

test('Freeも起動後に自動保存し、未ログイン・起動準備中には保存しない', () => {
  for (const [ready, userId, expected] of [[true, 'free-user', 1], [false, 'free-user', 0], [true, undefined, 0]] as const) {
    const calls: string[] = []
    const run = evaluate(callback('src/navigation/RootNavigator.tsx', 'autoBackup'), {
      ready, session: userId ? { user: { id: userId } } : null,
      planLoading: false, planTier: 'free', autoBackupStartedForRef: { current: null },
      runAutoBackupIfDue: (id: string) => { calls.push(id); return Promise.resolve('done') },
      backupAlertShownRef: { current: false }, takeBackupNotice: async () => null, showBackupNotice: () => {},
      InteractionManager: { runAfterInteractions: (task: () => void) => { task(); return { cancel: () => {} } } },
    })
    run()
    assert.equal(calls.length, expected)
  }
})

test('設定画面のログアウト確認もFreeの控えを省略しない', () => {
  const file = 'src/screens/SettingsScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress' && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expression = node.initializer.expression
      if (expression?.getText(source).includes('Saves desks and gadgets')) found = expression
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found)
  const calls: boolean[] = []
  const press = evaluate(found.getText(source), {
    language: 'ja', backupAvailable: false,
    runLogOut: (discardUnsaved = false) => { calls.push(discardUnsaved) },
    Alert: { alert: (_title: string, _message: string, buttons: any[]) => { buttons[1].onPress() } },
  })
  press()
  assert.deepEqual(calls, [false])
})

test('最新のアカウントバックアップはFreeとProの両方で使える', () => {
  assert.equal(PLAN_LIMITS.free.autoBackup, true)
  assert.equal(PLAN_LIMITS.pro.autoBackup, true)
})

test('アカウントの画面が切り替わると、復元へ渡した通信キャンセルも発火する', async () => {
  let signal: AbortSignal | undefined
  let finish!: (value: string) => void
  const ready: (string | null | undefined)[] = []
  const run = evaluate(callback('src/navigation/RootNavigator.tsx', 'reconcile'), {
    localReady: true, session: { user: { id: 'old-user' } }, AbortController,
    setAccountDataFailed: () => {}, withTimeout: (work: unknown) => work,
    setAccountDataReadyFor: (value: string | null | undefined) => { ready.push(value) },
    reconcileAccountData: (_userId: string, passedSignal: AbortSignal) => {
      signal = passedSignal
      return new Promise<string>((resolve) => { finish = resolve })
    },
  })
  const cleanup = run()
  assert.ok(signal)
  assert.equal(signal.aborted, false)
  cleanup()
  assert.equal(signal.aborted, true)
  finish('restored')
  await Promise.resolve()
  assert.deepEqual(ready, [undefined])
})

test('ログアウト中は削除が終わるまで認証画面の切り替えを待たせる', async () => {
  let entered!: () => void
  let finish!: () => void
  const clearing = new Promise<void>(resolve => { entered = resolve })
  const release = new Promise<void>(resolve => { finish = resolve })
  const ending: boolean[] = []
  const h = logout('done', { ending: value => { ending.push(value) }, clear: async () => { entered(); await release } })
  const work = h.run()
  await clearing
  assert.deepEqual(ending, [true])
  finish()
  await work
  assert.deepEqual(ending, [true, false])
})

test('ログアウトが失敗した場合も画面の待機状態は解除し、端末のデータは消さない', async () => {
  const ending: boolean[] = []
  const h = logout('done', { ending: value => { ending.push(value) }, signOut: async () => { throw new Error('sign out failed') } })
  await assert.rejects(h.run(), /sign out failed/)
  assert.deepEqual(ending, [true, false])
  assert.deepEqual(h.calls, ['backup', 'deskCleanup', 'signOut'])
})
test('同じアカウントへ再ログインしても、ゲストデータを合わせた後の自動保存を省略しない', () => {
  const started = { current: 'pro-user' as string | null }
  const calls: string[] = []
  const bindings = {
    autoBackupStartedForRef: started,
    runAutoBackupIfDue: (userId: string) => { calls.push(userId); return Promise.resolve('done') },
    backupAlertShownRef: { current: false }, takeBackupNotice: async () => null, showBackupNotice: () => {},
    InteractionManager: { runAfterInteractions: (run: () => void) => { run(); return { cancel() {} } } },
  }
  const code = callback('src/navigation/RootNavigator.tsx', 'autoBackup')
  evaluate(code, { ...bindings, ready: false, session: null })()
  assert.equal(started.current, null)
  evaluate(code, { ...bindings, ready: true, session: { user: { id: 'pro-user' } } })()
  assert.deepEqual(calls, ['pro-user'])
})

test('自動保存が止まっていたら起動時に知らせ、突き合わせの案内を出した起動では重ねない', async () => {
  for (const [alerted, expected] of [[false, ['conflict']], [true, []]] as const) {
    const shown: string[] = []
    evaluate(callback('src/navigation/RootNavigator.tsx', 'autoBackup'), {
      ready: true, session: { user: { id: 'user' } }, autoBackupStartedForRef: { current: null },
      backupAlertShownRef: { current: alerted },
      runAutoBackupIfDue: async () => 'conflict',
      takeBackupNotice: async (result: string) => result,
      showBackupNotice: (notice: string) => { shown.push(notice) },
      InteractionManager: { runAfterInteractions: (run: () => void) => { run(); return { cancel() {} } } },
    })()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(shown, expected)
  }
})
