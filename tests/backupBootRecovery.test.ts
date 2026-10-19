import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { withTimeout } from '../src/utils/networkError'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function sourceExpression(name: string): string {
  const file = 'src/navigation/RootNavigator.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  function visit(node: ts.Node) {
    if (name === 'bootRecovery' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('await withTimeout(recoverInterruptedRestore()')) found = node.arguments[0]
    if (name === 'accountRecovery' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('withTimeout(reconcileAccountData(')) found = node.arguments[0]
    if (name === 'authWaiting' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('setAuthWaitFailed(true)')) found = node.arguments[0]
    if (name === 'restoredOnboarding' && ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('void markOnboardingDone()')) found = node.arguments[0]
    if (name === 'retryRecovery' && ts.isJsxAttribute(node) && node.name.getText(source) === 'onPress' && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(source).includes('setAuthWaitFailed(false)')) found = node.initializer.expression
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found)
  return found.getText(source)
}
function evaluate(expression: string, bindings: Record<string, any>) {
  const module = { exports: undefined as any }
  runInNewContext(ts.transpileModule(`module.exports = (${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { module, ...bindings })
  return module.exports
}
function boot(recover: () => Promise<boolean>) {
  const calls: string[] = []
  const run = evaluate(sourceExpression('bootRecovery'), {
    setTimeout, clearTimeout, BOOT_DATA_TIMEOUT_MS: 20,
    withTimeout: (promise: Promise<any>) => promise, recoverInterruptedRestore: recover,
    preloadGadgets: async () => { calls.push('gadgets') }, preloadPlans: async () => { calls.push('plans') },
    setRecoveryFailed: (value: boolean) => { calls.push(`failed:${value}`) },
    setRecoveryReady: (value: boolean) => { calls.push(`recovered:${value}`) },
    setInitialDataReady: (value: boolean) => { calls.push(`loaded:${value}`) },
    analytics: { error: () => { calls.push('error') } }, hideNativeSplash: () => { calls.push('hideSplash') },
  })
  return { cleanup: run(), calls }
}

test('再インストールで初回フラグが消えても、認証済みなら本編へ進む', async () => {
  const state = (session: unknown, onboarded: boolean, authSkipped = false) => evaluate(sourceExpression('appState'), {
    session, onboarded, sessionLikely: false, authSkipped,
  })
  assert.equal(state({ user: { id: 'me' } }, false), 'main')
  assert.equal(state(null, false), 'onboarding')
  assert.equal(state(null, true), 'auth')
  assert.equal(state(null, true, true), 'main')
  let marked = 0
  let onboarded = false
  const run = evaluate(sourceExpression('restoredOnboarding'), {
    ready: true, session: { user: { id: 'me' } }, onboarded,
    setOnboarded: (value: boolean) => { onboarded = value },
    markOnboardingDone: async () => { marked++ },
  })
  run()
  await flush()
  assert.equal(onboarded, true)
  assert.equal(marked, 1)
})

test('再インストール後の自動復元失敗では空の本編を出さず、再試行後に解禁する', async () => {
  const ready: unknown[] = []
  const failed: boolean[] = []
  let restored = false
  const run = evaluate(sourceExpression('accountRecovery'), {
    localReady: true, session: { user: { id: 'me' } }, AbortController, Error, withTimeout, lang: 'ja',
    setAccountDataReadyFor: (value: unknown) => { ready.push(value) },
    setAccountDataFailed: (value: boolean) => { failed.push(value) },
    reconcileAccountData: async () => restored ? 'restored' : 'failed',
    backupAlertShownRef: { current: false }, Alert: { alert() {} },
    analytics: { error() {} }, hideNativeSplash() {},
  })
  const cleanup = run()
  await flush()
  assert.deepEqual(ready, [undefined])
  assert.equal(failed.at(-1), true)
  cleanup()
  restored = true
  const retryCleanup = run()
  await flush()
  assert.equal(ready.at(-1), 'me')
  assert.equal(failed.at(-1), false)
  retryCleanup()
})

test('壊れたバックアップは通信失敗と区別し、別の世代を選ぶための設定画面へ進める', async () => {
  const ready: unknown[] = []
  const alerts: string[] = []
  const run = evaluate(sourceExpression('accountRecovery'), {
    localReady: true, session: { user: { id: 'me' } }, AbortController, Error, withTimeout, lang: 'ja',
    setAccountDataReadyFor: (value: unknown) => { ready.push(value) }, setAccountDataFailed() {},
    reconcileAccountData: async () => 'needs-review', backupAlertShownRef: { current: false },
    Alert: { alert: (_title: string, message: string) => { alerts.push(message) } },
    analytics: { error() {} }, hideNativeSplash() {},
  })
  const cleanup = run()
  await flush()
  assert.equal(ready.at(-1), 'me')
  assert.match(alerts[0], /別の世代/)
  cleanup()
})

test('起動時は途中復元の復旧を終えるまで、デスク・ガジェットのキャッシュを読み込まない', async () => {
  let finish!: (value: boolean) => void
  const recovery = new Promise<boolean>(resolve => { finish = resolve })
  const h = boot(() => recovery)
  await flush()
  assert.deepEqual(h.calls, ['failed:false', 'recovered:false'])
  finish(true)
  await flush()
  assert.deepEqual(h.calls, ['failed:false', 'recovered:false', 'recovered:true', 'gadgets', 'plans', 'loaded:true'])
  h.cleanup()
})

test('復旧できない起動では本編の編集・保存を解禁せず、再試行の画面を表示する', async () => {
  const h = boot(async () => { throw new Error('no space') })
  await flush()
  assert.deepEqual(h.calls, ['failed:false', 'recovered:false', 'error', 'failed:true', 'hideSplash'])
  h.cleanup()
})

test('復旧中に起動処理が取り消されたら、遅い応答で一覧読み込みや操作解禁を始めない', async () => {
  let finish!: (value: boolean) => void
  const h = boot(() => new Promise<boolean>(resolve => { finish = resolve }))
  h.cleanup()
  finish(true)
  await flush()
  assert.deepEqual(h.calls, ['failed:false', 'recovered:false'])
})

test('初回起動でも復旧が終わるまでは本編・オンボーディングへの遷移を待たせる', () => {
  const bindings = { isBootReady: () => true, themeReady: true, authLoading: false, onboarded: false, authSkipped: false, initialDataReady: false }
  assert.equal(evaluate(sourceExpression('localReady'), { ...bindings, recoveryReady: false }), false)
  assert.equal(evaluate(sourceExpression('localReady'), { ...bindings, recoveryReady: true }), true)
})

test('アカウントのデータ確認が無応答なら復旧画面を表示し、遅い旧応答で編集を解禁しない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal!: AbortSignal
  let finish!: (result: string) => void
  let attempt = 0
  const ready: unknown[] = []
  const failures: boolean[] = []
  const calls: string[] = []
  const run = evaluate(sourceExpression('accountRecovery'), {
    localReady: true, session: { user: { id: 'me' } }, AbortController, Error, withTimeout,
    setAccountDataReadyFor: (value: unknown) => { ready.push(value) },
    setAccountDataFailed: (value: boolean) => { failures.push(value) },
    reconcileAccountData: (_user: string, passed: AbortSignal) => {
      signal = passed
      return ++attempt === 1 ? new Promise<string>(resolve => { finish = resolve }) : Promise.resolve('not-needed')
    },
    analytics: { error: () => { calls.push('error') } }, hideNativeSplash: () => { calls.push('hide') },
  })
  const cleanup = run()
  t.mock.timers.tick(60_000)
  await flush()
  assert.deepEqual(failures, [false, true])
  assert.equal(signal.aborted, true)
  assert.deepEqual(calls, ['error', 'hide'])
  finish('restored')
  await flush()
  assert.deepEqual(ready, [undefined])
  cleanup()
  const cleanupRetry = run()
  await flush()
  assert.deepEqual(ready, [undefined, undefined, 'me'])
  assert.equal(failures.at(-1), false)
  cleanupRetry()
})

test('有効なアカウント確認が取り消された場合も、起動待ちを続けず再試行へ進む', async () => {
  const failures: boolean[] = []
  const run = evaluate(sourceExpression('accountRecovery'), {
    localReady: true, session: { user: { id: 'me' } }, AbortController, Error, withTimeout,
    setAccountDataReadyFor: () => {}, setAccountDataFailed: (value: boolean) => { failures.push(value) },
    reconcileAccountData: async () => 'cancelled', analytics: { error: () => {} }, hideNativeSplash: () => {},
  })
  const cleanup = run()
  await flush()
  assert.deepEqual(failures, [false, true])
  cleanup()
})

test('認証の終了処理が端末保存で停止しても、スプラッシュを解除して再起動の案内を表示する', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const failed: boolean[] = []
  let hidden = 0
  const run = evaluate(sourceExpression('authWaiting'), {
    authLoading: true, setTimeout, clearTimeout,
    setAuthWaitFailed: (value: boolean) => { failed.push(value) }, hideNativeSplash: () => { hidden++ },
  })
  const cleanup = run()
  t.mock.timers.tick(60_000)
  assert.deepEqual(failed, [true])
  assert.equal(hidden, 1)
  cleanup()
})

test('認証とデータ確認が両方停止した再試行でも、認証待ちの期限を再設定する', () => {
  let recovery = 0
  let reconcile = 0
  const run = evaluate(sourceExpression('retryRecovery'), {
    accountDataFailed: true, recoveryFailed: false, authWaitFailed: true,
    setAuthWaitFailed: () => {}, setAccountDataFailed: () => {},
    setRecoveryAttempt: (update: (value: number) => number) => { recovery = update(recovery) },
    setReconcileRun: (update: (value: number) => number) => { reconcile = update(reconcile) },
  })
  run()
  assert.equal(recovery, 1)
  assert.equal(reconcile, 0)
})
