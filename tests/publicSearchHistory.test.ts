import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { normalizePublicDeskSearch } from '../src/utils/publicDeskFeed'
import { localUserDataKeys } from '../src/utils/localUserDataKeys'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function harness(options: { read?: () => Promise<void>; write?: () => Promise<void>; store?: Map<string, string> } = {}) {
  const store = options.store ?? new Map<string, string>()
  const modules = new Map<string, any>()
  function load(file: string): any {
    if (modules.has(file)) return modules.get(file)
    const module = { exports: {} as any }
    modules.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    runInNewContext(code, { module, exports: module.exports, require: (id: string) => {
      if (id === '@react-native-async-storage/async-storage') return {
        getItem: async (key: string) => { await options.read?.(); return store.get(key) ?? null },
        setItem: async (key: string, value: string) => { await options.write?.(); store.set(key, value) },
        removeItem: async (key: string) => { store.delete(key) },
      }
      if (id.endsWith('/publicDeskFeed')) return { normalizePublicDeskSearch }
      if (id.endsWith('/localDataOperation')) return load('src/utils/localDataOperation.ts')
      throw new Error('Unexpected module: ' + id)
    } })
    return module.exports
  }
  return {
    store, history: load('src/store/publicSearchHistoryStore.ts'), operations: load('src/utils/localDataOperation.ts'),
  }
}

test('最新5件を保存し、再起動しても読み込める', async () => {
  const h = harness()
  for (const query of ['one', 'two', 'three', 'four', 'five', 'six']) await h.history.recordPublicSearch(query, 'me')
  const reboot = harness({ store: h.store })
  assert.deepEqual(Array.from(await reboot.history.loadPublicSearchHistory('me')), ['six', 'five', 'four', 'three', 'two'])
})

test('空白・全角・大文字の違いを重複させず、再検索した語を先頭へ戻す', async () => {
  const h = harness()
  await h.history.recordPublicSearch('  ＭＡＣ　ＢＯＯＫ  ', null)
  await h.history.recordPublicSearch('Keyboard', null)
  await h.history.recordPublicSearch('mac   book', null)
  await h.history.recordPublicSearch('   ', null)
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory(null)), ['mac book', 'Keyboard'])
})

test('古い・壊れた履歴を安全に読み、長い検索語を検索欄と同じ上限へ揃える', async () => {
  const h = harness()
  const key = h.history.PUBLIC_SEARCH_HISTORY_PREFIX + 'me'
  for (const raw of ['{broken', '{}', 'null']) {
    h.store.set(key, raw)
    assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('me')), [])
  }
  h.store.set(key, JSON.stringify([null, 123, '', 'ｋｅｙｂｏａｒｄ', 'Keyboard', 'a'.repeat(100)]))
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('me')), ['keyboard', 'a'.repeat(80)])
})

test('続けて検索しても先の記録を失わず、消去後の検索も保存できる', async () => {
  const h = harness()
  await Promise.all(['a', 'b', 'c'].map(query => h.history.recordPublicSearch(query, 'me')))
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('me')), ['c', 'b', 'a'])
  await h.history.clearPublicSearchHistory('me')
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('me')), [])
  await h.history.recordPublicSearch('new', 'me')
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('me')), ['new'])
})

test('ゲストと別アカウントの履歴を表示・消去で混ぜず、ログアウトでは全て削除する', async () => {
  const h = harness()
  for (const owner of [null, 'first', 'second']) await h.history.recordPublicSearch(owner ?? 'guest', owner)
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('second')), ['second'])
  await h.history.clearPublicSearchHistory('second')
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('first')), ['first'])
  const keys = localUserDataKeys([...h.store.keys(), 'app_theme'])
  assert.equal(keys.length, 2)
  assert.equal(keys.includes('app_theme'), false)
  for (const key of keys) h.store.delete(key)
  assert.deepEqual(Array.from(await h.history.loadPublicSearchHistory('first')), [])
})

test('ログアウトで無効になった読み書きは、削除後へ古い履歴を保存しない', async () => {
  const started = deferred()
  const finish = deferred()
  const h = harness({ read: async () => { started.resolve(); await finish.promise } })
  const save = h.history.recordPublicSearch('old', 'first')
  await started.promise
  h.operations.invalidateLocalDataOperations()
  const clear = h.operations.serializeLocalDataOperation(async () => {
    for (const key of localUserDataKeys([...h.store.keys()])) h.store.delete(key)
  })
  finish.resolve()
  await Promise.all([save, clear])
  assert.equal(h.store.size, 0)
})

test('履歴の保存中にログアウトしても、保存を終えてから削除する', async () => {
  const started = deferred()
  const finish = deferred()
  const h = harness({ write: async () => { started.resolve(); await finish.promise } })
  const save = h.history.recordPublicSearch('old', 'first')
  await started.promise
  h.operations.invalidateLocalDataOperations()
  const clear = h.operations.serializeLocalDataOperation(async () => {
    for (const key of localUserDataKeys([...h.store.keys()])) h.store.delete(key)
  })
  finish.resolve()
  await Promise.all([save, clear])
  assert.equal(h.store.size, 0)
})
