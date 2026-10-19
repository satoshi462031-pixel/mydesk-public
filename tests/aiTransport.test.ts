import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { splitStreamEvents } from '../src/services/ai/streamEvents'
import type { sendChatMessage as SendChatMessage } from '../src/services/ai/openai'
import { QUICK_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'
import { assertResponseOrigin } from '../src/utils/secureTransport'

function transport(responses: Response[], overrides: { fetch?: typeof fetch; getSession?: () => Promise<any>; refreshSession?: () => Promise<any> } = {}) {
  const calls: Array<{ body: string; headers: Record<string, string> }> = []
  const exports = {} as { sendChatMessage: typeof SendChatMessage }
  const code = ts.transpileModule(readFileSync('src/services/ai/openai.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    exports, TextDecoder, AbortController, Error, setTimeout, clearTimeout,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.invalid', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'test' } },
    require: (id: string) => {
      if (id === 'expo/fetch') return { fetch: overrides.fetch ?? (async (_url: string, options: typeof calls[number]) => {
        calls.push(options)
        return responses.shift()!
      }) }
      if (id === '../../supabase/client') return { supabaseUrl: 'https://example.invalid', supabase: { auth: {
        getSession: overrides.getSession ?? (async () => ({ data: { session: { access_token: 'old-token' } } })),
        refreshSession: overrides.refreshSession ?? (async () => ({ data: { session: { access_token: 'new-token' } } })),
      } } }
      if (id === './streamEvents') return { splitStreamEvents }
      if (id.endsWith('/networkError')) return { QUICK_TIMEOUT_MS, withTimeout }
      if (id.endsWith('/secureTransport')) return { assertResponseOrigin }
      throw new Error(`Unexpected module: ${id}`)
    },
  })
  let displayed = ''
  return {
    calls,
    get displayed() { return displayed },
    send: (signal?: AbortSignal) => exports.sendChatMessage([{ role: 'user', content: '配線を確認' }], 'ja', 'request-1', {
      onDelta: (text) => { displayed += text },
      onReplace: (text) => { displayed = text },
    }, signal),
  }
}

function stream(payload: string, chunkSize = 3) {
  const bytes = new TextEncoder().encode(payload)
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } })
}

test('日本語がバイトの途中で切れても、完了した本文と利用枠を受け取る', async () => {
  const client = transport([stream('{"type":"delta","text":"配線を整理します"}\n{"type":"done","usage":{"msg_count":2,"msg_limit":10}}\n', 1)])
  const result = await client.send()
  assert.equal(result.content, '配線を整理します')
  assert.equal(client.displayed, result.content)
  assert.equal(result.usage?.msgCount, 2)
})

test('完了通知が来る前に通信が閉じたら、不完全な回答を成功扱いしない', async () => {
  const client = transport([stream('{"type":"delta","text":"回答の途中"}\n')])
  await assert.rejects(client.send(), /通信が途切れ/)
})

test('壊れた行の後に完了通知があっても、欠けた回答や安全性の差し替えを確定しない', async () => {
  for (const bad of ['{"type":"delta"', '{"type":"delta","text":null}', '{"type":"replace","text":42}']) {
    const client = transport([stream(`{"type":"delta","text":"途中の本文"}\n${bad}\n{"type":"done"}\n`)] )
    await assert.rejects(client.send(), /正しく受信できませんでした/)
  }
})

test('AIの認証付き送信はリダイレクトを許可しない', async () => {
  const client = transport([stream('{"type":"delta","text":"回答"}\n{"type":"done"}\n')])
  await client.send()
  assert.equal((client.calls[0] as unknown as RequestInit).redirect, 'error')
  assert.equal((client.calls[0] as unknown as RequestInit).credentials, 'omit')
})

test('最後の完了行に改行が無くても利用枠を読み取る', async () => {
  const client = transport([stream('{"type":"delta","text":"回答"}\n{"type":"done","usage":{"msg_count":4}}')])
  assert.equal((await client.send()).usage?.msgCount, 4)
})

test('完了通知の利用枠はトークン制で受け取り、未取得のトークン量をゼロに変えない', async () => {
  const client = transport([stream('{"type":"delta","text":"回答"}\n{"type":"done","usage":{"is_pro":true,"msg_count":40,"photo_count":6,"token_count":120000,"token_limit":150000}}\n')])
  const result = await client.send()
  assert.equal(result.usage?.tokenCount, 120_000)
  assert.equal(result.usage?.tokenLimit, 150_000)
  assert.equal(result.usage?.isPro, true)
  const missing = transport([stream('{"type":"delta","text":"回答"}\n{"type":"done","usage":{"is_pro":true,"token_count":null,"token_limit":null}}\n')])
  const unknownUsage = (await missing.send()).usage
  assert.equal(unknownUsage?.tokenCount, null)
  assert.equal(unknownUsage?.tokenLimit, null)
})

test('最後の失敗行に改行が無くても部分的な本文を確定しない', async () => {
  const client = transport([stream('{"type":"delta","text":"回答の途中"}\n{"type":"error","error":"生成失敗","status":502}')])
  await assert.rejects(client.send(), /生成失敗/)
})

test('安全性による差し替えを確定し、401の再試行は同じリクエストIDで送る', async () => {
  const client = transport([
    new Response('{}', { status: 401 }),
    stream('{"type":"delta","text":"元の本文"}\n{"type":"replace","text":"差し替え"}\n{"type":"done"}\n'),
  ])
  assert.equal((await client.send()).content, '差し替え')
  assert.equal(client.displayed, '差し替え')
  assert.equal(client.calls.length, 2)
  assert.equal(client.calls[0].body, client.calls[1].body)
  assert.equal(client.calls[1].headers.Authorization, 'Bearer new-token')
})

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

test('完了通知が届けば、接続終了やreader.cancelの無応答を待たず回答を確定する', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"完了"}\n{"type":"done"}\n')) },
    cancel() { cancelled = true; return new Promise(() => {}) },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  assert.equal((await transport([response]).send()).content, '完了')
  assert.equal(cancelled, true)
})

test('認証・初回接続・本文・再認証が無応答でも、それぞれの期限で失敗する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const phase of ['session', 'fetch', 'read', 'refresh', 'json'] as const) {
    const hanging = () => new Promise<any>(() => {})
    const response = new Response(new ReadableStream(), { headers: { 'Content-Type': phase === 'json' ? 'application/json' : 'application/x-ndjson' } })
    const client = transport(phase === 'refresh' ? [new Response('{}', { status: 401 })] : [response], {
      ...(phase === 'session' ? { getSession: hanging } : {}),
      ...(phase === 'fetch' ? { fetch: hanging } : {}),
      ...(phase === 'refresh' ? { refreshSession: hanging } : {}),
    })
    const rejected = assert.rejects(client.send(), /timed out/)
    await flush()
    t.mock.timers.tick(phase === 'session' || phase === 'refresh' ? 20_000 : 45_000)
    await rejected
  }
})

test('受信処理がAbortSignalを無視していても画面の中断操作で待機を解除する', async () => {
  const controller = new AbortController()
  const client = transport([], { fetch: () => new Promise(() => {}) })
  const rejected = assert.rejects(client.send(controller.signal), { name: 'AbortError' })
  await flush()
  controller.abort()
  await rejected
  assert.equal(client.displayed, '')
})

test('受信が少しずつ続いても3分を超えると待機を解除する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let push!: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream({ start(controller) { push = controller } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
  const client = transport([response])
  const rejected = assert.rejects(client.send(), /180000ms/)
  await flush()
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(30_000)
    push.enqueue(new TextEncoder().encode('{"type":"delta","text":"続き"}\n'))
    await flush()
  }
  t.mock.timers.tick(30_000)
  await rejected
})
