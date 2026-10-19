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

function secureStorage(failOnWrite?: (key: string) => boolean) {
  const store = new Map<string, string>()
  const service = load('src/supabase/sessionStorage.ts', id => {
    if (id.endsWith('/networkError')) return { STORAGE_TIMEOUT_MS: 5000, withTimeout: (work: unknown) => work }
    if (id === 'react-native') return { Platform: { OS: 'ios' } }
    if (id === 'expo-secure-store') return {
      getItemAsync: async (key: string) => store.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        if (failOnWrite?.(key)) throw new Error('keychain write failed')
        store.set(key, value)
      },
      deleteItemAsync: async (key: string) => { store.delete(key) },
    }
    if (id === '@react-native-async-storage/async-storage') return { default: { getItem: async () => null, removeItem: async () => {} } }
    throw new Error(id)
  })
  return { storage: service.sessionStorage, store }
}

const sessionOf = (user: string, token: string) => JSON.stringify({ access_token: token, refresh_token: `${token}-refresh`, user: { id: user }, pad: 'x'.repeat(1500) })

test('分割保存の途中で失敗しても、前のセッションが丸ごと読める（新旧が混ざらない）', async () => {
  let failing = false
  let writes = 0
  const h = secureStorage(() => failing && ++writes === 2)
  const before = sessionOf('user-a', 'token-a')
  await h.storage.setItem('session', before)
  failing = true
  await assert.rejects(h.storage.setItem('session', sessionOf('user-b', 'token-b')), /unavailable/)
  assert.equal(await h.storage.getItem('session'), before)
})

test('世代を交互に使い、書き込み後に前の世代と失敗した書き込みの残りを消す', async () => {
  let failing = true
  let writes = 0
  const h = secureStorage(key => failing && key.startsWith('session.b.') && ++writes === 3)
  await h.storage.setItem('session', sessionOf('user-a', 'token-a'))
  await assert.rejects(h.storage.setItem('session', sessionOf('user-a', 'token-a2')))
  failing = false
  const short = JSON.stringify({ access_token: 't', user: { id: 'user-a' } })
  const next = sessionOf('user-a', 'token-a3')
  await h.storage.setItem('session', next)
  assert.equal(await h.storage.getItem('session'), next)
  await h.storage.setItem('session', next.replace('token-a3', 'token-a4'))
  assert.equal(await h.storage.getItem('session'), next.replace('token-a3', 'token-a4'))
  await h.storage.setItem('session', short)
  assert.deepEqual([...h.store.keys()], ['session'])
  await h.storage.removeItem('session')
  assert.equal(h.store.size, 0)
})

test('世代を持つ前の版が書いたセッションを読め、次の保存で古いチャンクを消す', async () => {
  const h = secureStorage()
  const legacy = sessionOf('user-a', 'token-a')
  const parts = legacy.match(/[\s\S]{1,600}/g)!
  parts.forEach((part, i) => h.store.set(`session.${i}`, part))
  h.store.set('session', `chunks:${parts.length}`)
  assert.equal(await h.storage.getItem('session'), legacy)
  const next = sessionOf('user-a', 'token-a2')
  await h.storage.setItem('session', next)
  assert.equal(await h.storage.getItem('session'), next)
  assert.equal([...h.store.keys()].some(key => /^session\.\d+$/.test(key)), false)
})
