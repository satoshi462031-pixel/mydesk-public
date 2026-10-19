import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { trimInvisible } from '../src/utils/truncateText'

const source = ts.createSourceFile('AICoachChatScreen.tsx', readFileSync('src/screens/AICoachChatScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function callback(name: string, bindings: Record<string, unknown>) {
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      expression = node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression)
  const code = ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return runInNewContext(code, bindings)
}

function sendGate(overrides: Record<string, unknown> = {}) {
  const requests: unknown[][] = []
  const navigations: string[] = []
  const metrics: unknown[] = []
  let limitAlerts = 0
  let tierAlerts = 0
  const bindings = {
    loaded: true, canUse: true, proLocked: false, tierSyncing: false, lang: 'ja', tokenCount: 10_000, tokenLimit: 150_000,
    requestInFlightRef: { current: false }, historyReadInFlightRef: { current: false },
    messagesRef: { current: [] }, lastImageRef: { current: null }, lastHistoryEnabledRef: { current: true },
    trimInvisible, endStream: () => {}, refresh: () => {},
    navigation: { navigate: (screen: string) => navigations.push(screen) },
    trackLimitHit: (_name: string, data: unknown) => metrics.push(data),
    showUsageLimit: () => { limitAlerts++ }, Alert: { alert: () => { tierAlerts++ } },
    isAIHistoryEnabled: async () => false, newMessageId: () => 'message', Crypto: { randomUUID: () => 'request' },
    setMessages: () => {}, runRequest: async (...args: unknown[]) => { requests.push(args) },
    ...overrides,
  }
  return {
    send: callback('doSend', bindings) as (text: string, image?: { uri: string; base64: string; type: string }) => Promise<void>,
    requests, navigations, metrics, get limitAlerts() { return limitAlerts }, get tierAlerts() { return tierAlerts },
  }
}

test('文章・写真の送信は共通枠で受け付け、写真用の追加消費を要求しない', async () => {
  for (const image of [undefined, { uri: 'photo', base64: 'image', type: 'image/jpeg' }]) {
    const gate = sendGate()
    await gate.send('相談', image)
    assert.equal(gate.requests.length, 1)
    assert.equal(gate.requests[0][1], image)
    assert.equal(gate.limitAlerts, 0)
    assert.equal(gate.navigations.length, 0)
  }
})

test('共通枠を使い切ったProは文章・写真とも送信を止め、購入画面へ誘導しない', async () => {
  for (const image of [undefined, { uri: 'photo', base64: 'image', type: 'image/jpeg' }]) {
    const gate = sendGate({ canUse: false, tokenCount: 150_000 })
    await gate.send('相談', image)
    assert.equal(gate.requests.length, 0)
    assert.equal(gate.limitAlerts, 1)
    assert.equal(gate.navigations.length, 0)
    assert.equal((gate.metrics[0] as { max: number }).max, 150_000)
  }
})

test('Freeは購入画面へ、購入反映待ちは再確認の案内へ進む', async () => {
  const free = sendGate({ canUse: false, proLocked: true, tokenLimit: 0 })
  await free.send('相談')
  assert.deepEqual(free.navigations, ['Paywall'])
  assert.equal(free.limitAlerts, 0)
  const syncing = sendGate({ canUse: false, proLocked: true, tierSyncing: true })
  await syncing.send('相談')
  assert.equal(syncing.navigations.length, 0)
  assert.equal(syncing.requests.length, 0)
  assert.equal(syncing.tierAlerts, 1)
})

test('回答を作り直す際の事前判定でも、Proの枠切れを再購入に結びつけない', async () => {
  const navigations: string[] = []
  let alerts = 0
  const requestInFlightRef = { current: false }
  const run = callback('runRequest', {
    aiAccessAllowed: true, requestInFlightRef, requestTokenRef: { current: 0 }, setIsLoading: () => {},
    AbortController, streamAbortRef: { current: null }, lastImageRef: { current: null }, consume: async () => false,
    isPro: true, tokenCount: 150_000, tokenLimit: 150_000, trackLimitHit: () => {},
    showUsageLimit: () => { alerts++ }, navigation: { navigate: (screen: string) => navigations.push(screen) }, endStream: () => {},
  }) as (messages: unknown[]) => Promise<void>
  await run([{ role: 'user', content: '相談' }])
  assert.equal(alerts, 1)
  assert.equal(navigations.length, 0)
  assert.equal(requestInFlightRef.current, false)
})
