import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(file: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports, Error, Promise, AbortController,
    require: (id: string) => {
      if (!(id in modules)) throw new Error('Unexpected module: ' + id)
      return modules[id]
    },
    ...globals,
  })
  return module.exports
}

function crashHarness(failure?: 'scope' | 'tag' | 'capture' | 'eventId', enabled = true) {
  const captured: unknown[] = []
  const tags: unknown[] = []
  const unavailable = () => { throw new Error('SDK unavailable') }
  const service = load('src/services/crashReporting.ts', {
    '@sentry/react-native': {
      init: () => {}, setTag: () => {},
      withScope: (run: (scope: unknown) => void) => {
        if (failure === 'scope') unavailable()
        run({ setTag: (...args: unknown[]) => { if (failure === 'tag') unavailable(); tags.push(args) } })
      },
      captureException: (error: unknown) => { if (failure === 'capture') unavailable(); captured.push(error) },
      lastEventId: () => { if (failure === 'eventId') unavailable(); return 'event-id' },
    },
    'expo-updates': { updateId: null, isEmbeddedLaunch: true },
  }, { __DEV__: !enabled, process: { env: { EXPO_PUBLIC_SENTRY_DSN: 'https://example.test' } } })
  return { service, captured, tags }
}

test('例外記録SDKの失敗が、元のエラー通知や復旧を止めない', () => {
  for (const failure of ['scope', 'tag', 'capture'] as const) {
    const { service } = crashHarness(failure)
    assert.doesNotThrow(() => service.captureCrash(new Error('operation failed'), 'save'))
  }
})

test('例外記録が有効な場合は原因と操作名を保持し、無効な場合は送信しない', () => {
  const error = new Error('original')
  const active = crashHarness()
  active.service.captureCrash(error, 'save')
  assert.deepEqual(active.captured, [error])
  assert.deepEqual(active.tags, [['operation', 'save']])
  assert.equal(active.service.lastCrashEventId(), 'event-id')
  const disabled = crashHarness('scope', false)
  assert.doesNotThrow(() => disabled.service.captureCrash(error, 'save'))
  assert.equal(disabled.service.lastCrashEventId(), undefined)
  assert.deepEqual(disabled.captured, [])
})

test('例外IDが取得できなくてもフィードバックを送信できる', async () => {
  const crash = crashHarness('eventId')
  assert.equal(crash.service.lastCrashEventId(), undefined)
  const h = feedbackHarness({ lastCrashEventId: crash.service.lastCrashEventId })
  await h.service.submitFeedback({ ...input, attachTrail: true })
  assert.equal(h.events[0].event, 'feedback_submitted')
  assert.equal(h.timers.size, 0)
})

const input = { category: 'bug', body: '利用者の入力', attachTrail: false, environment: { lang: 'ja', theme: 'light', plan: 'free' } }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function feedbackHarness(options: { session?: () => Promise<unknown>; query?: (signal: AbortSignal) => Promise<unknown>; prepare?: () => void; lastCrashEventId?: () => string | undefined } = {}) {
  const timers = new Map<number, { run: () => void; ms: number }>()
  let nextId = 0
  const globals = {
    setTimeout: (run: () => void, ms: number) => { const id = ++nextId; timers.set(id, { run, ms }); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
  }
  const events: { event: string; props: Record<string, unknown> }[] = []
  let inserts = 0
  const networkError = load('src/utils/networkError.ts', { './localizedError': {} }, globals)
  const service = load('src/services/feedbackService.ts', {
    'react-native': { Platform: { OS: 'ios', Version: '18' } },
    'expo-updates': { isEnabled: false },
    '../../app.json': { expo: { version: '1.0.0' } },
    '../supabase/client': { supabase: {
      auth: { getSession: options.session ?? (async () => ({ data: { session: { user: { id: 'user' } } }, error: null })) },
      from: () => ({ insert: () => {
        inserts++
        options.prepare?.()
        return { abortSignal: (signal: AbortSignal) => options.query?.(signal) ?? Promise.resolve({ error: null }) }
      } }),
    } },
    './analytics': {
      EVENTS: { FEEDBACK_FAILED: 'feedback_failed', FEEDBACK_SUBMITTED: 'feedback_submitted' },
      analytics: { track: (event: string, props: Record<string, unknown>) => { events.push({ event, props }) } },
      errorProperties: (error: any) => ({ error_code: error.code ?? 'unknown' }),
    },
    './crashReporting': { lastCrashEventId: options.lastCrashEventId ?? (() => undefined) },
    '../utils/diagnosticTrail': { snapshotTrail: () => [] },
    '../utils/truncateText': { truncateChars: (text: string, max: number) => text.slice(0, max) },
    '../utils/networkError': networkError,
  }, globals)
  return { service, timers, events, inserts: () => inserts }
}

test('フィードバックの応答エラー・通信例外・同期例外で元の原因を返し、失敗を一度記録してタイマーを解放する', async () => {
  const error = Object.assign(new Error('secret input'), { code: 'E_NETWORK' })
  for (const options of [
    { query: async () => ({ error }) },
    { query: async () => { throw error } },
    { prepare: () => { throw error } },
    { session: async () => { throw error } },
  ]) {
    const h = feedbackHarness(options)
    await assert.rejects(h.service.submitFeedback(input), error)
    assert.equal(h.timers.size, 0)
    assert.equal(h.events.length, 1)
    assert.equal(h.events[0].event, 'feedback_failed')
    assert.equal(h.events[0].props.error_code, 'E_NETWORK')
    assert.ok(!JSON.stringify(h.events).includes('secret input'))
    assert.ok(!JSON.stringify(h.events).includes(input.body))
  }
})

test('認証の読み込みが返らなくても送信待機を解除し、認証失敗時には送信しない', async () => {
  let finish!: (value: unknown) => void
  const h = feedbackHarness({ session: () => new Promise(resolve => { finish = resolve }) })
  const result = h.service.submitFeedback(input)
  const rejected = assert.rejects(result, /timed out/)
  assert.equal(h.timers.size, 1)
  const [id, timer] = [...h.timers.entries()][0]
  assert.equal(timer.ms, 20_000)
  h.timers.delete(id)
  timer.run()
  await rejected
  finish({ data: { session: { user: { id: 'late' } } }, error: null })
  await flush()
  assert.equal(h.timers.size, 0)
  assert.equal(h.inserts(), 0)
  assert.equal(h.events.length, 1)
  assert.equal(h.events[0].event, 'feedback_failed')
  const authError = new Error('session expired')
  const invalid = feedbackHarness({ session: async () => ({ data: { session: { user: { id: 'old' } } }, error: authError }) })
  await assert.rejects(invalid.service.submitFeedback(input), authError)
  assert.equal(invalid.inserts(), 0)
  const loggedOut = feedbackHarness({ session: async () => ({ data: { session: null }, error: null }) })
  await assert.rejects(loggedOut.service.submitFeedback(input), /AUTH_REQUIRED/)
  assert.equal(loggedOut.inserts(), 0)
})

test('送信期限を過ぎたら通信を中断して再試行でき、次の成功を失敗として記録しない', async () => {
  const error = Object.assign(new Error('aborted'), { code: 'ABORT' })
  let attempts = 0
  const h = feedbackHarness({ query: signal => {
    if (++attempts > 1) return Promise.resolve({ error: null })
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(error)))
  } })
  const result = h.service.submitFeedback(input)
  const rejected = assert.rejects(result, error)
  await flush()
  assert.equal(h.timers.size, 1)
  ;[...h.timers.values()][0].run()
  await rejected
  assert.equal(h.timers.size, 0)
  await h.service.submitFeedback(input)
  assert.equal(h.timers.size, 0)
  assert.deepEqual(h.events.map(item => item.event), ['feedback_failed', 'feedback_submitted'])
})
test('不具合報告の認証待ちに本人が替わったら前の本人の下書きを送信しない', async () => {
  const h = feedbackHarness({ session: async () => ({ data: { session: { user: { id: 'next' } } }, error: null }) })
  await assert.rejects(h.service.submitFeedback({ ...input, expectedUserId: 'previous' }), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(h.inserts(), 0)
})
