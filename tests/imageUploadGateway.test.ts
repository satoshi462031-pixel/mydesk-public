import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import { handleImageUpload, MAX_IMAGE_BYTES, type ImageUploadStore } from '../supabase/functions/upload-desk-image/handler'
import { PUBLISH_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'

const user = '11111111-2222-4333-8444-555555555555'
const desk = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const path = `${user}/${desk}/image.jpg`
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0, 255, 217])
function harness() {
  const calls: string[] = []
  const state = { owned: true, blocked: false }
  const store: ImageUploadStore = {
    ownsDesk: async () => state.owned,
    reserve: async (_id, bytes) => { calls.push(`reserve:${bytes}`); if (state.blocked) throw new Error('IMAGE_UPLOAD_RATE_LIMITED') },
    upload: async (name, bytes) => { assert.deepEqual(bytes, jpeg); calls.push(`upload:${name}`) },
    copy: async (source, target) => { calls.push(`copy:${source}:${target}`) },
    imageSize: async () => jpeg.length,
  }
  const upload = (name = path, bytes = jpeg) => handleImageUpload(new Request('https://example.invalid', {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Image-Path': name }, body: bytes,
  }), user, store)
  const copy = (source = path, target = `${user}/${desk}/new.jpg`) => handleImageUpload(new Request('https://example.invalid', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, target }),
  }), user, store)
  return { calls, state, upload, copy }
}

test('画像の実バイト数を確保してから保存し、コピーも最大サイズの予算を確保する', async () => {
  const h = harness()
  assert.equal((await h.upload()).status, 200)
  assert.deepEqual(h.calls, [`reserve:${jpeg.length}`, `upload:${path}`])
  h.calls.length = 0
  assert.equal((await h.copy()).status, 200)
  assert.deepEqual(h.calls, [`reserve:${MAX_IMAGE_BYTES}`, `copy:${path}:${user}/${desk}/new.jpg`])
})

test('他人のパス・他人のデスク・パストラバーサル・別フォルダへのコピーを拒否する', async () => {
  const h = harness()
  for (const invalid of [path.replace(user, desk), `${user}/../image.jpg`, `${user}/${desk}/image.jpg?x=1`, `${user}/${desk}/%2e%2e.jpg`]) {
    assert.equal((await h.upload(invalid)).status, 400)
  }
  h.state.owned = false
  assert.equal((await h.upload()).status, 400)
  h.state.owned = true
  assert.equal((await h.copy(path, `${user}/avatar/new.jpg`)).status, 400)
  assert.equal((await h.copy(path, path)).status, 400)
  assert.deepEqual(h.calls, [])
})

test('上限到達後は実体の保存・コピーへ進まない', async () => {
  const h = harness()
  h.state.blocked = true
  assert.equal((await h.upload()).status, 429)
  assert.equal((await h.copy()).status, 429)
  assert.ok(h.calls.every((call) => call.startsWith('reserve:')))
})

test('JPEG以外とサイズ超過を、予算確保前に拒否する', async () => {
  const h = harness()
  assert.equal((await h.upload(path, new Uint8Array([1, 2, 3, 4]))).status, 400)
  assert.equal((await h.upload(path, new Uint8Array(MAX_IMAGE_BYTES + 1))).status, 413)
  assert.deepEqual(h.calls, [])
})

test('停止した画像本文は20秒で打ち切り、保存を始めない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls: string[] = []
  const request = new Request('https://example.invalid', { method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'X-Image-Path': `${user}/avatar/image.jpg` },
    body: new ReadableStream({ pull() { return new Promise(() => {}) } }), duplex: 'half',
  } as RequestInit)
  const pending = handleImageUpload(request, user, {
    ownsDesk: async () => true, reserve: async () => { calls.push('reserve') },
    upload: async () => { calls.push('upload') }, copy: async () => {}, imageSize: async () => jpeg.length,
  })
  await new Promise<void>(resolve => setImmediate(resolve))
  t.mock.timers.tick(20_000)
  assert.equal((await pending).status, 503)
  assert.deepEqual(calls, [])
})

test('実際のSupabase SDKで画像をJSON化せず送信し、成功応答を検査する', async () => {
  const requests: Request[] = []
  let result: unknown = { ok: true }
  const client = createClient('https://example.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => { requests.push(new Request(input, init)); return Response.json(result) } },
  })
  const module = { exports: {} as { uploadPublicImage(path: string, bytes: Uint8Array): Promise<void>; copyPublicImage(source: string, target: string): Promise<void> } }
  runInNewContext(ts.transpileModule(readFileSync('src/services/imageUploadGateway.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, setTimeout, clearTimeout, AbortController,
    require: (id: string) => id.endsWith('/supabase/client') ? { supabase: client } : { PUBLISH_TIMEOUT_MS, withTimeout },
  })
  await module.exports.uploadPublicImage(path, jpeg)
  assert.equal(requests[0].url, 'https://example.supabase.co/functions/v1/upload-desk-image')
  assert.equal(requests[0].headers.get('X-Image-Path'), path)
  assert.equal(requests[0].headers.get('Content-Type'), 'image/jpeg')
  assert.deepEqual(new Uint8Array(await requests[0].arrayBuffer()), jpeg)
  await module.exports.copyPublicImage(path, 'target')
  assert.deepEqual(await requests[1].json(), { source: path, target: 'target' })
  result = {}
  await assert.rejects(module.exports.uploadPublicImage(path, jpeg), /IMAGE_UPLOAD_UNCONFIRMED/)
})
