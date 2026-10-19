import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

test('写真のサイズ・変換・ファイル・本文の無応答を打ち切り、遅い応答で公開を始めない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const phase of ['size', 'decode', 'file', 'body'] as const) {
    let blocked = true
    let uploads = 0
    const module = { exports: {} as any }
    const late: (() => void)[] = []
    const pending = (value: unknown) => new Promise<any>(resolve => { late.push(() => resolve(value)) })
    const bucket = {
      upload: async () => { uploads++; return { error: null } },
      getPublicUrl: () => ({ data: { publicUrl: 'https://example.invalid/photo.jpg' } }),
    }
    const code = ts.transpileModule(readFileSync('src/services/storage.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText
    runInNewContext(code, { module, exports: module.exports, URL, fetch: async () => {
      const response = { arrayBuffer: () => blocked && phase === 'body' ? pending(new ArrayBuffer(1)) : Promise.resolve(new ArrayBuffer(1)) }
      if (blocked && phase === 'file') return pending(response)
      return response
    }, require: (id: string) => {
      if (id === 'expo-crypto') return { randomUUID: () => 'token' }
      if (id === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async () => blocked && phase === 'decode' ? pending({ uri: 'file://photo.jpg' }) : { uri: 'file://photo.jpg' } }
      if (id === 'react-native') return { Image: { getSize: (_uri: string, done: (w: number, h: number) => void) => { if (blocked && phase === 'size') late.push(() => done(1000, 1000)); else done(1000, 1000) } } }
      if (id.endsWith('/supabase/client')) return { supabase: { storage: { from: () => bucket } } }
      if (id === './imageUploadGateway') return { uploadPublicImage: () => bucket.upload() }
      if (id.endsWith('/networkError')) return { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS, withTimeout }
      throw new Error(id)
    } })
    const failed = assert.rejects(module.exports.uploadAvatarImage('user', 'file://original.jpg'), /timed out/)
    await flush()
    t.mock.timers.tick(phase === 'decode' ? 60_000 : 20_000)
    await failed
    assert.equal(uploads, 0)
    blocked = false
    late.forEach(finish => finish())
    await flush()
    assert.equal(uploads, 0)
    assert.equal(await module.exports.uploadAvatarImage('user', 'file://retry.jpg'), 'https://example.invalid/photo.jpg')
    assert.equal(uploads, 2)
  }
})
