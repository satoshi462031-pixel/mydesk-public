import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as attribution from '../src/utils/analyticsAttribution'
import { deferredAnalyticsAction } from '../src/utils/analyticsDeferred'
import { sanitizeAnalyticsProperties } from '../src/utils/analyticsProperties'
import { secureHttpUrl } from '../src/utils/secureTransport'

function analyticsClient(host = 'https://example.com') {
  const stored = new Map<string, string>()
  const captured: Array<{ event: string; props: Record<string, unknown> }> = []
  const hosts: string[] = []
  class PostHog {
    constructor(_key: string, options: { host: string }) { hosts.push(options.host) }
    optedIn = false
    optIn() { this.optedIn = true }
    optOut() { this.optedIn = false }
    reset() {}
    capture(event: string, props: Record<string, unknown>) {
      assert.equal(this.optedIn, true, 'オプトアウト中にSDKへ送信してはいけない')
      captured.push({ event, props })
    }
  }
  const module = { exports: {} }
  const source = ts.transpileModule(readFileSync('src/services/analytics.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(source, { module, exports: module.exports, __DEV__: false, Intl, URL, require: (id: string) => {
    if (id === '@react-native-async-storage/async-storage') return {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => { stored.set(key, value) },
      removeItem: async (key: string) => { stored.delete(key) },
    }
    if (id === 'react-native') return { Platform: { OS: 'ios', Version: 18 } }
    if (id === 'posthog-react-native') return { PostHog }
    if (id.endsWith('/plans')) return { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: host }
    if (id.endsWith('/secureTransport')) return { secureHttpUrl }
    if (id.endsWith('/analyticsAttribution')) return attribution
    if (id.endsWith('/analyticsDeferred')) return { deferredAnalyticsAction }
    if (id.endsWith('/analyticsProperties')) return { sanitizeAnalyticsProperties }
    if (id.endsWith('/crashReporting')) return { captureCrash: () => {} }
    if (id.endsWith('/diagnosticTrail')) return { recordFailure: () => {} }
    if (id.endsWith('/url')) return { isAffiliateUrl: () => false }
    if (id === '../../app.json') return { expo: { version: '1.0.0' } }
    throw new Error(`Unexpected import: ${id}`)
  } })
  return { client: module.exports as typeof import('../src/services/analytics'), stored, captured, hosts }
}

test('分析の接続先が平文HTTPならSDKを起動せず、アプリの処理は継続する', async () => {
  const { client, captured, hosts } = analyticsClient('http://example.com')
  await client.setAnalyticsConsent(true)
  await client.initAnalytics('test-user')
  client.analytics.track(client.EVENTS.APP_OPENED)
  assert.deepEqual(hosts, [])
  assert.deepEqual(captured, [])
})

test('未同意の初回到達4種類を保留し、同意後に各1件だけ送る', async () => {
  const { client, stored, captured } = analyticsClient()
  await client.initAnalytics()
  const milestones = [client.EVENTS.FIRST_ITEM_ADDED, client.EVENTS.FIRST_RESULT_VIEWED,
    client.EVENTS.FIRST_PERSONALIZED_RESULT_VIEWED, client.EVENTS.FIRST_PUBLIC_DESK_VIEWED]
  for (const event of milestones) await client.trackOnce(event, { source: 'test' })
  assert.equal(captured.length, 0)
  for (const event of milestones) assert.ok(stored.has('@analytics_pending_once:' + event))
  await client.setAnalyticsConsent(true)
  await client.setAnalyticsConsent(true)
  for (const event of milestones) {
    const events = captured.filter((item) => item.event === event)
    assert.equal(events.length, 1)
    assert.equal(events[0].props.deferred_until_consent, true)
    assert.equal(stored.has('@analytics_pending_once:' + event), false)
  }
})

test('同意済みの初回到達は並行呼び出しでも重複せず、遅延扱いにしない', async () => {
  const { client, captured } = analyticsClient()
  await client.setAnalyticsConsent(true)
  await Promise.all([client.trackOnce(client.EVENTS.FIRST_PUBLIC_DESK_VIEWED),
    client.trackOnce(client.EVENTS.FIRST_PUBLIC_DESK_VIEWED)])
  const events = captured.filter((item) => item.event === client.EVENTS.FIRST_PUBLIC_DESK_VIEWED)
  assert.equal(events.length, 1)
  assert.equal(events[0].props.deferred_until_consent, undefined)
  await client.setAnalyticsConsent(false)
  client.analytics.track(client.EVENTS.ONBOARDING_STARTED)
  assert.equal(captured.filter((item) => item.event === client.EVENTS.ONBOARDING_STARTED).length, 0)
})

test('初回体験の観測入口は目的付きで完了より先に記録する', async () => {
  const source = ts.createSourceFile('OnboardingScreen.tsx', readFileSync('src/screens/OnboardingScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression = ''
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleStart' && node.initializer) expression = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression)
  const events: Array<{ event: string; props: Record<string, unknown> }> = []
  const run = runInNewContext(ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    startInFlightRef: { current: false }, startedAt: { current: Date.now() },
    analytics: { track: (event: string, props: Record<string, unknown>) => events.push({ event, props }) },
    EVENTS: { ONBOARDING_STARTED: 'started', ONBOARDING_INTRO_COMPLETED: 'intro', ONBOARDING_COMPLETED: 'completed' },
    markOnboardingDone: async () => {}, skipAuth: async () => {},
    withTimeout: (promise: Promise<unknown>) => promise, STORAGE_TIMEOUT_MS: 1000,
    navigation: { isFocused: () => true, replace: () => {} },
  }) as (destination: string) => Promise<void>
  await run('explore')
  assert.deepEqual(events.map((item) => item.event), ['started', 'intro', 'completed'])
  assert.equal(events[0].props.destination, 'explore')
  assert.equal(events[0].props.measurement_start, 'after_consent')
})
