import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as textUtils from '../src/utils/truncateText'
import * as network from '../src/utils/networkError'
import * as ids from '../src/utils/shortDeskId'

const id = '11111111-2222-4333-8444-555555555555'
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function harness(file: string, options: { auth?: () => Promise<any>; query?: (signal: AbortSignal) => Promise<any> } = {}) {
  const calls: { table: string; payload: any; signal?: AbortSignal }[] = []
  let authCalls = 0
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { module, exports: module.exports, AbortController, Error, setTimeout, clearTimeout, require: (name: string) => {
    if (name.endsWith('/supabase/client')) return { supabase: {
      auth: { getUser: async () => { authCalls++; return options.auth?.() ?? { data: { user: { id } }, error: null } } },
      from: (table: string) => ({ insert: (payload: unknown) => {
        const call = { table, payload } as typeof calls[number]
        calls.push(call)
        return { abortSignal: (signal: AbortSignal) => { call.signal = signal; return options.query?.(signal) ?? Promise.resolve({ error: null }) } }
      } }),
    } }
    if (name.endsWith('/truncateText')) return textUtils
    if (name.endsWith('/networkError')) return network
    if (name.endsWith('/shortDeskId')) return ids
    throw new Error(name)
  } })
  return { api: module.exports, calls, authCalls: () => authCalls }
}
const aiInput = { reason: 'unsafe', response: 'answer', prompt: 'question', conversationId: 'conversation', messageId: 'message' }

test('通報とAI報告は現在の認証済み本人のIDを使い、本文の上限を守る', async () => {
  const desk = harness('src/services/moderationService.ts')
  await desk.api.reportDesk(id, 'spam', '😀'.repeat(1100))
  assert.equal(desk.calls[0].payload.reporter_id, id)
  assert.equal([...desk.calls[0].payload.note].length, 1000)
  const ai = harness('src/services/aiReportService.ts')
  await ai.api.submitAIReport({ ...aiInput, reporter_id: 'forged', response: '😀'.repeat(8100), prompt: '😀'.repeat(2100) })
  assert.equal(ai.calls[0].payload.reporter_id, id)
  assert.equal([...ai.calls[0].payload.response_text].length, 8000)
  assert.equal([...ai.calls[0].payload.prompt_text].length, 2000)
})
test('不正な理由・対象ID・空の回答は認証照会やDB送信前に拒否する', async () => {
  const desk = harness('src/services/moderationService.ts')
  await assert.rejects(desk.api.reportDesk('bad', 'spam'), /INVALID_REPORT/)
  await assert.rejects(desk.api.reportDesk(id, 'bad'), /INVALID_REPORT/)
  assert.equal(desk.authCalls(), 0)
  const ai = harness('src/services/aiReportService.ts')
  for (const input of [{ ...aiInput, reason: 'bad' }, { ...aiInput, conversationId: 'x'.repeat(101) }, { ...aiInput, messageId: '' }, { ...aiInput, response: ' ' }]) await assert.rejects(ai.api.submitAIReport(input))
  assert.equal(ai.authCalls(), 0)
})
test('認証照会の通信エラーやログアウト状態では通報を送らない', async () => {
  const authError = new Error('offline')
  for (const file of ['moderationService', 'aiReportService']) {
    for (const error of [null, authError]) {
      const h = harness('src/services/' + file + '.ts', { auth: async () => ({ data: { user: null }, error }) })
      await assert.rejects(file === 'moderationService' ? h.api.reportDesk(id, 'spam') : h.api.submitAIReport(aiInput))
      assert.equal(h.calls.length, 0)
    }
  }
})
test('認証の無応答に期限を設け、後から届いた本人情報で通報しない', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let finish!: (value: any) => void
  const h = harness('src/services/aiReportService.ts', { auth: () => new Promise(resolve => { finish = resolve }) })
  const rejected = assert.rejects(h.api.submitAIReport(aiInput), /timed out/)
  t.mock.timers.tick(20000)
  await rejected
  finish({ data: { user: { id } }, error: null })
  await flush()
  assert.equal(h.calls.length, 0)
})
test('通報とAI報告は送信停止を中断し、自動再送せず次の操作を受け付ける', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const file of ['moderationService', 'aiReportService']) {
    let stalled = true
    const h = harness('src/services/' + file + '.ts', { query: signal => stalled
      ? new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      : Promise.resolve({ error: null }) })
    const submit = () => file === 'moderationService' ? h.api.reportDesk(id, 'spam') : h.api.submitAIReport(aiInput)
    const rejected = assert.rejects(submit(), /aborted|timed out/)
    await flush()
    t.mock.timers.tick(20000)
    await rejected
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].signal!.aborted, true)
    stalled = false
    await submit()
    assert.equal(h.calls.length, 2)
  }
})
test('同じ対象への再通報の既存の扱いを維持する', async () => {
  const duplicate = { code: '23505' }
  const desk = harness('src/services/moderationService.ts', { query: async () => ({ error: duplicate }) })
  await desk.api.reportDesk(id, 'spam')
  const ai = harness('src/services/aiReportService.ts', { query: async () => ({ error: duplicate }) })
  await assert.rejects(ai.api.submitAIReport(aiInput), error => (error as any).code === '23505')
})

function callback(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let arrow: ts.Node | undefined
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) arrow = node.initializer.arguments[0]
    ts.forEachChild(node, walk)
  }
  walk(source)
  assert.ok(arrow)
  return runInNewContext(ts.transpileModule('(' + arrow.getText(source) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bindings)
}
test('通報ボタンの連続操作で同じ送信を並行実行せず、失敗後に解除する', async () => {
  let calls = 0
  let fail!: (error: Error) => void
  const reportInFlightRef = { current: false }
  const submit = callback('src/screens/PublicDeskScreen.tsx', 'submitReport', {
    desk: { id }, reportInFlightRef, ja: true, lang: 'ja',
    reportDesk: () => { calls++; return new Promise((_resolve, reject) => { fail = reject }) },
    Alert: { alert: () => {} }, localizedErrorMessage: () => 'failed',
  })
  const pending = submit('spam')
  await submit('spam')
  assert.equal(calls, 1)
  fail(new Error('offline'))
  await pending
  assert.equal(reportInFlightRef.current, false)
})
test('報告理由を選ぶ間に会話が替わっても元の回答の会話IDを送り、多重送信を防ぐ', async () => {
  const convIdRef = { current: 'original-conversation' }
  const aiReportInFlightRef = { current: false }
  let buttons: any[]
  let resolve!: () => void
  const submitted: any[] = []
  const handle = callback('src/screens/AICoachChatScreen.tsx', 'handleReportAIResponse', {
    convIdRef, aiReportInFlightRef, messagesRef: { current: [{ role: 'user', content: 'original question' }] }, lang: 'ja',
    Alert: { alert: (_title: string, _message: string, choices: any[]) => { if (choices) buttons = choices } },
    submitAIReport: (input: any) => { submitted.push(input); return new Promise<void>(done => { resolve = done }) },
  })
  handle({ id: 'answer', content: 'original answer' }, 1)
  convIdRef.current = 'next-conversation'
  buttons![1].onPress()
  buttons![1].onPress()
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0].conversationId, 'original-conversation')
  assert.equal(submitted[0].prompt, 'original question')
  resolve()
  await flush()
  assert.equal(aiReportInFlightRef.current, false)
})
test('連投制限を通信障害ではなく送信上限として扱う', async () => {
  for (const file of ['moderationService', 'aiReportService']) {
    const h = harness('src/services/' + file + '.ts', { query: async () => ({ error: { code: 'P0001', message: 'REPORT_RATE_LIMITED' } }) })
    await assert.rejects(file === 'moderationService' ? h.api.reportDesk(id, 'spam') : h.api.submitAIReport(aiInput), /REPORT_RATE_LIMITED/)
  }
})
