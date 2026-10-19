import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { createTimeoutFetch, timeoutFetch } from '../src/utils/timeoutFetch'
import { isNetworkError } from '../src/utils/networkError'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
const url = 'https://example.invalid/rest/v1/desks'

test('平文HTTPへの送信は認証ヘッダーを渡す前に拒否する', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}') })
  await assert.rejects(timeoutFetch('http://example.invalid/rest/v1/desks', { headers: { Authorization: 'Bearer test-only' } }), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('ネイティブ用の通信にも転送拒否を渡し、Requestの本文とヘッダーを保持する', async () => {
  let options: RequestInit | undefined
  const secured = createTimeoutFetch(async (target, init) => {
    assert.equal(target, url)
    options = init
    return new Response('{}')
  })
  await secured(new Request(url, { method: 'POST', headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' }, body: '{"name":"デスク"}' }))
  assert.equal(options!.redirect, 'error')
  assert.equal(options!.credentials, 'omit')
  assert.equal(options!.method, 'POST')
  assert.equal(new Headers(options!.headers).get('authorization'), 'Bearer test-only')
  assert.equal(await new Response(options!.body).text(), '{"name":"デスク"}')
})

test('本文の受信が途中で切れたときはSDKへ成功レスポンスを返さない', async t => {
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('[{"id":"desk"'))
    controller.error(new Error('connection reset'))
  } }))
  t.mock.method(globalThis, 'fetch', async () => response)
  await assert.rejects(timeoutFetch(url), /connection reset/)
})

test('本文の準備中に期限を過ぎたRequestは、準備が後から終わっても送信しない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
  const request = new Request(url, { method: 'POST', body, duplex: 'half' } as RequestInit)
  let calls = 0
  const secured = createTimeoutFetch(async () => { calls++; return new Response('{}') })
  const rejected = assert.rejects(secured(request), /timed out/)
  await flush()
  t.mock.timers.tick(20_000)
  await rejected
  controller.enqueue(new TextEncoder().encode('{}'))
  controller.close()
  await flush()
  assert.equal(calls, 0)
})

test('別の接続先へ転送された応答は破棄し、SDKも自動で再試行しない', async t => {
  let calls = 0
  let aborted = false
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++
    init?.signal?.addEventListener('abort', () => { aborted = true })
    return Object.defineProperty(new Response('[{"id":"fake"}]'), 'url', { value: 'https://other.invalid/rest/v1/desks' })
  })
  const client = createClient('https://example.invalid', 'test', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch },
  })
  const { data, error } = await client.from('desks').select('*')
  assert.equal(data, null)
  assert.ok(error)
  assert.equal(aborted, true)
  assert.equal(calls, 1)
})

test('通常通信の無応答は20秒で中断し、SDKの自動再試行で待ち続けない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal: AbortSignal | undefined
  let calls = 0
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++
    signal = init?.signal ?? undefined
    return new Promise(() => {})
  })
  const client = createClient('https://example.invalid', 'test', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch },
  })
  const result = Promise.resolve(client.from('desks').select('*'))
  await flush()
  t.mock.timers.tick(20_000)
  const { error } = await result
  assert.ok(isNetworkError(error))
  assert.equal(signal?.aborted, true)
  assert.equal(calls, 1)
})

test('ヘッダー到着後に本文が止まっても期限を延長せず失敗を返す', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('[')) } }))
  t.mock.method(globalThis, 'fetch', async () => response)
  const rejected = assert.rejects(timeoutFetch(url), /timed out/)
  await flush()
  t.mock.timers.tick(20_000)
  await rejected
})

test('画像通信には60秒を許容し、上限で中断する', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal!: AbortSignal
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => { signal = init!.signal!; return new Promise(() => {}) })
  const rejected = assert.rejects(timeoutFetch('https://example.invalid/storage/v1/object/images/photo.jpg'), /60000ms/)
  t.mock.timers.tick(20_000)
  assert.equal(signal.aborted, false)
  t.mock.timers.tick(40_000)
  await rejected
  assert.equal(signal.aborted, true)
})

test('画像ゲートウェイも60秒を許容し、従来の画像保存より短く切らない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let signal!: AbortSignal
  const secured = createTimeoutFetch(async (_url, init) => { signal = init!.signal!; return new Promise(() => {}) })
  const rejected = assert.rejects(secured('https://example.invalid/functions/v1/upload-desk-image'), /60000ms/)
  t.mock.timers.tick(20_000)
  assert.equal(signal.aborted, false)
  t.mock.timers.tick(40_000)
  await rejected
  assert.equal(signal.aborted, true)
})

test('呼び出し側のキャンセルを保ち、既に中断されたリクエストは送信しない', async t => {
  let calls = 0
  let signal!: AbortSignal
  t.mock.method(globalThis, 'fetch', (_input: RequestInfo | URL, init?: RequestInit) => { calls++; signal = init!.signal!; return new Promise(() => {}) })
  const controller = new AbortController()
  const rejected = assert.rejects(timeoutFetch(new Request(url, { signal: controller.signal })), { name: 'AbortError' })
  controller.abort()
  await rejected
  assert.equal(signal.aborted, true)
  await assert.rejects(timeoutFetch(url, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('SDKのJSON・エラー本文・バイナリ・本文なしの応答を維持する', async t => {
  const responses = [
    new Response('[{"id":"desk"}]', { headers: { 'Content-Type': 'application/json' } }),
    new Response('{"message":"denied","code":"42501"}', { status: 403, statusText: 'Forbidden' }),
    new Response(new Uint8Array([0, 128, 255]), { headers: { 'Content-Type': 'application/octet-stream' } }),
    new Response(null, { status: 204 }),
  ]
  t.mock.method(globalThis, 'fetch', async () => responses.shift()!)
  const client = createClient('https://example.invalid', 'test', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch },
  })
  assert.deepEqual((await client.from('desks').select('*')).data, [{ id: 'desk' }])
  assert.equal((await client.from('desks').select('*')).error?.message, 'denied')
  const binary = await timeoutFetch(url)
  assert.deepEqual([...new Uint8Array(await binary.arrayBuffer())], [0, 128, 255])
  assert.equal(binary.headers.get('content-type'), 'application/octet-stream')
  assert.equal((await timeoutFetch(url)).status, 204)
})

test('RN の fetch（whatwg-fetch）でも、詰め直した本文の日本語を UTF-8 で読む', async t => {
  // Node の Response は ArrayBuffer も UTF-8 で読むため、RN と同じ Response を差し込まないと化けが再現しない。
  // whatwg-fetch は読み込み時に FileReader の有無で Blob 対応を決めるので、先に RN と同じく UTF-8 で読む FileReader を置く。
  class FileReaderStub {
    result: unknown = null
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsText(blob: Blob) { void blob.text().then(text => { this.result = text; this.onload?.() }) }
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(buffer => { this.result = buffer; this.onload?.() }) }
  }
  const g = globalThis as Record<string, unknown>
  const originalReader = g.FileReader
  const originalResponse = Response
  g.FileReader = FileReaderStub
  t.after(() => { g.FileReader = originalReader; g.Response = originalResponse })
  const { Response: RNResponse } = createRequire(__filename)('whatwg-fetch') as { Response: typeof Response }
  const json = '[{"description":"PC と Switch 2 を1台のモニターで","owner_name":"MyDesk 公式"}]'
  t.mock.method(globalThis, 'fetch', async () => new originalResponse(json, { headers: { 'Content-Type': 'application/json' } }))
  g.Response = RNResponse
  const client = createClient('https://example.invalid', 'test', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timeoutFetch },
  })
  assert.deepEqual((await client.from('desks').select('*')).data, JSON.parse(json))
})
