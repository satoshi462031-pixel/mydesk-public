import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as validation from '../supabase/functions/ai-coach/validation'
import * as usage from '../supabase/functions/ai-coach/usage'
import * as safety from '../supabase/functions/ai-coach/safety'
import * as tokenBudget from '../supabase/functions/ai-coach/tokenBudget'
import * as stream from '../supabase/functions/ai-coach/stream'

async function runStream(events: unknown[], rpcOverrides: Record<string, unknown> = {}, rpcErrors: Record<string, { code: string }> = {}) {
  const calls: string[] = []
  let handler!: (req: Request) => Promise<Response>
  const code = ts.transpileModule(readFileSync('supabase/functions/ai-coach/index.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const modules: Record<string, unknown> = {
    './validation.ts': validation, './usage.ts': usage, './safety.ts': safety,
    './tokenBudget.ts': tokenBudget, './stream.ts': stream,
  }
  runInNewContext(code, {
    exports: {}, Request, Response, ReadableStream, TextEncoder, TextDecoder,
    AbortController, AbortSignal, setTimeout, clearTimeout,
    console: { error() {}, warn() {} },
    Deno: { env: { get: (name: string) => name === 'AI_MAX_TOKENS' ? '2000' : 'test' }, serve: (fn: typeof handler) => { handler = fn } },
    require: (id: string) => {
      if (id.startsWith('https://esm.sh/')) return { createClient: () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }) },
        rpc: (name: string) => {
          calls.push(name)
          const data = name in rpcOverrides ? rpcOverrides[name]
            : name === 'claim_ai_request' ? [{ state: 'claimed' }]
            : name === 'is_pro_user' ? true
            : name === 'consume_ai_usage' ? [{ allowed: true, msg_count: 1, photo_count: 0, msg_limit: 10, photo_limit: 5 }]
            : name === 'reserve_ai_tokens' ? [{ allowed: true }]
            : null
          // supabase-js の rpc はビルダーを返し、check_account_access は .abortSignal() を挟んで待つ
          const result = Promise.resolve({ data: name in rpcErrors ? null : data, error: rpcErrors[name] ?? null })
          return Object.assign(result, { abortSignal: () => result })
        },
      }) }
      if (id in modules) return modules[id]
      throw new Error(`Unexpected module: ${id}`)
    },
    fetch: async (url: string) => url.endsWith('/count_tokens')
      ? Response.json({ input_tokens: 10 })
      : new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
  })
  const response = await handler(new Request('https://example.invalid/ai-coach', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '配線を確認' }], lang: 'ja', request_id: '12345678-1234-4123-8123-123456789012', stream: true }),
  }))
  return { calls, body: await response.text(), status: response.status }
}

const start = { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }
const delta = { type: 'content_block_delta', delta: { type: 'text_delta', text: '配線を整理できます。' } }
const finalUsage = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } }

test('上流の完了通知を受けた回答だけ保存・精算して確定する', async () => {
  const result = await runStream([start, delta, finalUsage, { type: 'message_stop' }])
  assert.equal(result.status, 200)
  assert.match(result.body, /"type":"done"/)
  assert.ok(result.calls.includes('complete_ai_request'))
  assert.ok(result.calls.includes('settle_ai_tokens'))
  assert.ok(!result.calls.includes('refund_ai_usage'))
})

test('上流が完了前に閉じたら本文を確定せず、利用枠と予約トークンを返す', async () => {
  const result = await runStream([start, delta])
  assert.match(result.body, /"type":"error"/)
  assert.doesNotMatch(result.body, /"type":"done"/)
  assert.ok(!result.calls.includes('complete_ai_request'))
  assert.ok(result.calls.includes('fail_ai_request'))
  assert.ok(result.calls.includes('refund_ai_usage'))
  assert.ok(result.calls.includes('release_ai_tokens'))
})

test('確定使用量だけ届いても、上流の完了通知が無ければ回答を確定しない', async () => {
  const result = await runStream([start, delta, finalUsage])
  assert.match(result.body, /"type":"error"/)
  assert.ok(!result.calls.includes('complete_ai_request'))
})

test('週のトークン予算で弾いたときは、返金後の回数を返す（表示だけ1回減らさない）', async () => {
  const result = await runStream([], { reserve_ai_tokens: [{ allowed: false }] })
  assert.equal(result.status, 429)
  assert.ok(result.calls.includes('refund_ai_usage'))
  assert.ok(!result.calls.includes('settle_ai_tokens'))
  assert.equal(JSON.parse(result.body).usage.msg_count, 0)
})

test('週のトークン枠で弾いたときは、使った量と枠を返す（回数の上限は返さない）', async () => {
  const result = await runStream([], { reserve_ai_tokens: [{ allowed: false, token_count: 149000, token_limit: 150000 }] })
  const usage = JSON.parse(result.body).usage
  assert.equal(usage.token_count, 149000)
  assert.equal(usage.token_limit, 150000)
  assert.equal('msg_limit' in usage, false)
  assert.equal('photo_limit' in usage, false)
})

test('回答の確定時は、予約ではなく精算後の今週の利用量を返す', async () => {
  const result = await runStream([start, delta, finalUsage, { type: 'message_stop' }], {
    reserve_ai_tokens: [{ allowed: true, token_count: 2010, token_limit: 150000 }],
    ai_token_usage: [{ token_count: 30, token_limit: 150000 }],
  })
  const done = result.body.trim().split('\n').map((line) => JSON.parse(line)).find((event) => event.type === 'done')
  assert.equal(done.usage.token_count, 30)
  assert.equal(done.usage.token_limit, 150000)
  assert.equal(done.usage.is_pro, true)
  assert.ok(result.calls.indexOf('ai_token_usage') > result.calls.indexOf('settle_ai_tokens'))
})

test('失効したログイン（105）では、利用枠にも上流にも触れずに 401 を返す', async () => {
  const result = await runStream([start, delta, finalUsage], {}, { check_account_access: { code: 'PT401' } })
  assert.equal(result.status, 401)
  assert.deepEqual(result.calls, ['check_account_access'])
})
