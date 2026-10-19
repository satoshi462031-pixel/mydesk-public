import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// UIから呼ばれる実際のリクエスト処理を実行し、写真の復元と送信の順序を検証する。
function requestHarness(loadImage: (uri: string) => Promise<any>, consume = async () => true) {
  const source = ts.createSourceFile('screen.tsx', readFileSync('src/screens/AICoachChatScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Node | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'runRequest' && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0]
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(callback)
  const user = { id: 'user', role: 'user', content: '写真を確認して', imageUri: 'saved.jpg' }
  const messagesRef = { current: [user] as any[] }
  const requestTokenRef = { current: 0 }
  const sentImages: any[] = []
  let consumeCount = 0
  const module = { exports: undefined as unknown as (...args: any[]) => Promise<void> }
  const context = {
    module, AbortController, Date,
    aiAccessAllowed: true, loaded: true, tierSyncing: false,
    navigation: { navigate: () => {} }, refresh: () => {},
    requestInFlightRef: { current: false }, requestTokenRef, streamAbortRef: { current: null },
    lastImageRef: { current: null }, streamMsgIdRef: { current: null },
    messagesRef, setMessages: (next: any) => { messagesRef.current = typeof next === 'function' ? next(messagesRef.current) : next },
    setIsLoading: () => {}, endStream: () => {},
    loadAIConversationImage: loadImage,
    consume: async () => { consumeCount++; return consume() },
    buildConversationMessages: (messages: any[], _lang: string, image: any) => { sentImages.push(image); return messages },
    sendChatMessage: async () => ({ content: '写真の回答', usage: {} }),
    Crypto: { randomUUID: () => 'request' },
    lang: 'ja', isPro: true, rootMounted: false, limit: 10,
    applyUsage: () => {}, trackLimitHit: () => {},
    analytics: { track: () => {}, error: () => {} }, EVENTS: { AI_FEATURE_USED: 'used' },
    newMessageId: () => 'response', persistConversation: async () => {},
    AIUsageLimitError: class extends Error {}, localizedErrorMessage: (error: Error) => error.message,
  }
  const code = ts.transpileModule(`module.exports = ${callback.getText(source)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, context)
  return { run: (image?: any, retry = false) => module.exports([user], image, retry), sentImages, messagesRef, requestTokenRef, consumeCount: () => consumeCount }
}

test('履歴を開き直した写真付き質問は保存画像を復元して再生成する', async () => {
  const restored = { uri: 'restored.jpg', base64: 'pixels', type: 'image/jpeg' }
  const harness = requestHarness(async uri => { assert.equal(uri, 'saved.jpg'); return restored })
  await harness.run()
  assert.equal(harness.sentImages[0], restored)
  assert.equal(harness.consumeCount(), 1)
  assert.equal(harness.messagesRef.current.at(-1).content, '写真の回答')
})

test('同じ画面内の再試行は既存画像を使い、利用枠を再消費しない', async () => {
  const cached = { uri: 'cached.jpg', base64: 'pixels', type: 'image/jpeg' }
  const harness = requestHarness(async () => { throw new Error('復元不要') })
  await harness.run(cached, true)
  assert.equal(harness.sentImages[0], cached)
  assert.equal(harness.consumeCount(), 0)
})

test('保存写真を読めないときは写真なしで送らず、利用枠も使わない', async () => {
  const harness = requestHarness(async () => { throw new Error('画像がありません') })
  await harness.run()
  assert.equal(harness.sentImages.length, 0)
  assert.equal(harness.consumeCount(), 0)
  assert.equal(harness.messagesRef.current.at(-1).isError, true)
})

test('写真復元中に会話を変更したときは旧質問を送信しない', async () => {
  let restore!: (image: any) => void
  const harness = requestHarness(() => new Promise(resolve => { restore = resolve }))
  const pending = harness.run()
  harness.requestTokenRef.current++
  restore({ uri: 'restored.jpg', base64: 'pixels', type: 'image/jpeg' })
  await pending
  assert.equal(harness.sentImages.length, 0)
  assert.equal(harness.consumeCount(), 0)
})

test('利用枠の確認中に会話を変更したときも旧質問を送信しない', async () => {
  let allow!: (value: boolean) => void
  const harness = requestHarness(async () => ({}), () => new Promise(resolve => { allow = resolve }))
  const pending = harness.run({ uri: 'cached.jpg', base64: 'pixels', type: 'image/jpeg' })
  harness.requestTokenRef.current++
  allow(true)
  await pending
  assert.equal(harness.sentImages.length, 0)
})
