import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(file: string, dependencies: (id: string) => unknown) {
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, Promise, Error, Object, Number, AbortController, require: dependencies })
  return module.exports
}

test('トークンの持ち主と保存した利用者が違えば、失効として扱う', async () => {
  const access = load('src/services/accountAccess.ts', id => {
    if (id.endsWith('/supabase/client')) return { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'user-b' } }, error: null }) } } }
    if (id.endsWith('/networkError')) return { withTimeout: (work: unknown) => work }
    throw new Error(id)
  })
  const error = await access.validateAccountAccess({ access_token: 'token-b', user: { id: 'user-a' } }).then(() => null, (e: unknown) => e)
  assert.ok(error)
  assert.equal(access.isAccountAccessRevoked(error), true)
  // 通信障害は失効にしない（BAN と取り違えて閉じない）
  assert.equal(access.isAccountAccessRevoked(new Error('offline')), false)
})
