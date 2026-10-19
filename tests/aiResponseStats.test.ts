import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { aiResponseStatsLabel } from '../src/utils/aiResponseStats'
import { buildConversationMessages } from '../src/services/ai/conversationContext'
import { repairStoredConversations } from '../src/utils/storedDataRepair'
import type { ChatMessage } from '../src/store/conversationStore'

test('AIの補足情報は待ち時間・全体時間・文字数を表示し、過去の未計測データに時間を補わない', () => {
  assert.equal(aiResponseStatsLabel('あ😀', { firstResponseMs: 1200, totalMs: 3400 }, 'ja'), '待機 1.2秒 · 全体 3.4秒 · 2文字')
  assert.equal(aiResponseStatsLabel('OK', { firstResponseMs: 500 }, 'en', true), 'Generating · Wait 0.5s · 2 characters')
  assert.equal(aiResponseStatsLabel('OK', { firstResponseMs: 500, totalMs: 2000, stopped: true }, 'ja'), '停止 · 待機 0.5秒 · 全体 2.0秒 · 2文字')
  assert.equal(aiResponseStatsLabel('昔の回答', undefined, 'ja'), null)
  assert.equal(aiResponseStatsLabel('回答', { firstResponseMs: NaN, totalMs: -1 }, 'ja'), '2文字')
})

function request(bindings: Record<string, unknown>) {
  const file = 'src/screens/AICoachChatScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'runRequest'
      && node.initializer && ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression)
  const code = ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return runInNewContext(code, bindings) as (messages: ChatMessage[]) => Promise<void>
}

for (const outcome of ['completed', 'stopped', 'reset'] as const) {
  test(`AI回答の計測を本文と一緒に保存する (${outcome})`, async () => {
    let now = 1000
    let saved: ChatMessage[] | undefined
    let refreshed = 0
    const user: ChatMessage = { id: 'user', role: 'user', content: '質問', createdAt: '', requestId: 'request' }
    const messagesRef = { current: [user] }
    const streamMsgIdRef = { current: null as string | null }
    const pendingTextRef = { current: '' }
    const requestTokenRef = { current: 0 }
    const streamAbortRef = { current: null as AbortController | null }
    const setMessages = (update: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])) => {
      messagesRef.current = typeof update === 'function' ? update(messagesRef.current) : update
    }
    const flushStreamText = () => {
      setMessages(messagesRef.current.map(m => m.id === streamMsgIdRef.current
        ? { ...m, content: m.content + pendingTextRef.current } : m))
      pendingTextRef.current = ''
    }
    const run = request({
      aiAccessAllowed: true, requestInFlightRef: { current: false }, requestTokenRef, streamAbortRef,
      setIsLoading: () => {}, Date: class extends Date { static now() { return now } }, AbortController,
      lastImageRef: { current: null }, consume: async () => true, buildConversationMessages, lang: 'ja',
      streamMsgIdRef, newMessageId: () => 'answer', messagesRef, setMessages, setStreaming: () => {},
      pendingTextRef, flushTimerRef: { current: null }, STREAM_FLUSH_MS: 60,
      setTimeout: () => 1, clearTimeout: () => {}, flushStreamText,
      sendChatMessage: async (_messages: unknown, _lang: string, _id: string, handlers: { onDelta: (text: string) => void }) => {
        now = 2250
        handlers.onDelta('あ😀')
        now = 4750
        if (outcome === 'stopped') {
          streamAbortRef.current!.abort()
          throw new Error('aborted')
        }
        if (outcome === 'reset') {
          requestTokenRef.current++
          throw new Error('old request')
        }
        return { content: 'あ😀', usage: null }
      },
      applyUsage: () => {}, refresh: async () => { refreshed++ }, analytics: { track: () => {}, error: () => assert.fail('送信が失敗した') },
      EVENTS: {}, isPro: true, rootMounted: false,
      endStream: () => { flushStreamText(); streamMsgIdRef.current = null },
      persistConversation: async (messages: ChatMessage[]) => { saved = JSON.parse(JSON.stringify(messages)) },
    })
    await run([user])
    // 停止は done が届かないので、サーバーで消費された枠を取り直す
    assert.equal(refreshed, outcome === 'stopped' ? 1 : 0)
    if (outcome === 'reset') {
      assert.equal(saved, undefined)
      return
    }
    const answer = saved?.find(m => m.role === 'assistant')
    assert.equal(answer?.content, 'あ😀')
    assert.equal(answer?.responseStats?.firstResponseMs, 1250)
    assert.equal(answer?.responseStats?.totalMs, 3750)
    assert.equal(answer?.responseStats?.stopped, outcome === 'stopped' ? true : undefined)
    const [restored] = repairStoredConversations<{ id: string; updatedAt: string; messages: ChatMessage[] }>([
      { id: 'chat', updatedAt: '', messages: saved },
    ])
    assert.deepEqual(restored.messages.at(-1)?.responseStats, answer?.responseStats)
    const sent = buildConversationMessages(saved!, 'ja')
    assert.equal('responseStats' in sent.at(-1)!, false)
  })
}
