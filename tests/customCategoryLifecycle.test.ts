import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { CUSTOM_CATEGORY_NAME_MAX, customCategoryOf, normalizeCustomCategory, normalizeCustomCategoryColor } from '../src/utils/customCategory'
import type { CustomCategory, Gadget } from '../src/types'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'

const figure: CustomCategory = { id: 'figure', name: 'フィギュア', icon: 'robot-happy-outline' }
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function harness(options: {
  initial?: CustomCategory[]
  read?: () => Promise<string | null>
  write?: (value: string) => Promise<void>
  gadgets?: Gadget[]
  updated?: (gadgets: Gadget[]) => void
} = {}) {
  let disk = options.initial ? JSON.stringify(options.initial) : null
  let sequence = 0
  const writes: string[] = []
  const states: any[] = []
  let cursor = 0
  let mounted = false
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/hooks/useCustomCategories.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports, Error,
    require: (id: string) => {
      if (id === '@react-native-async-storage/async-storage') return {
        getItem: () => options.read ? options.read() : Promise.resolve(disk),
        setItem: async (_key: string, value: string) => {
          await options.write?.(value)
          disk = value
          writes.push(value)
        },
      }
      if (id === 'react') return {
        useState: (initial: any) => {
          const at = cursor++
          if (!(at in states)) states[at] = initial
          return [states[at], (value: any) => { states[at] = value }]
        },
        useEffect: (effect: () => void) => { if (!mounted) { mounted = true; effect() } },
        useMemo: (run: () => unknown) => run(),
        useCallback: (run: unknown) => run,
      }
      if (id === 'uuid') return { v4: () => `new-${++sequence}` }
      if (id === '../utils/customCategory') return { CUSTOM_CATEGORY_NAME_MAX, customCategoryOf, normalizeCustomCategory, normalizeCustomCategoryColor }
      if (id === './useGadgets') return {
        useGadgets: () => ({ gadgets: options.gadgets ?? [], deletedGadgets: [], updateMany: async (gadgets: Gadget[]) => { options.updated?.(gadgets) } }),
      }
      if (id.endsWith('/networkError')) return { STORAGE_TIMEOUT_MS, withTimeout }
      throw new Error(`Unexpected module: ${id}`)
    },
  })
  return {
    api: module.exports, writes,
    render: () => { cursor = 0; return module.exports.useCustomCategories() },
    disk: () => disk === null ? [] : JSON.parse(disk) as CustomCategory[],
    setDisk: (categories: CustomCategory[]) => { disk = JSON.stringify(categories) },
  }
}

test('ジャンルの色を保存し、再読み込みと機材の写しにも引き継ぐ', async () => {
  let touched: Gadget[] = []
  const gear = { id: 'g', name: 'g', category: 'Other', ports: [], createdAt: '', customCategory: figure } as Gadget
  const h = harness({ initial: [figure], gadgets: [gear], updated: (gadgets) => { touched = gadgets } })
  const saved = await h.render().update(figure.id, { name: figure.name, icon: 'desk-monitor-shelf', color: '#159d67' })
  assert.equal(saved.color, '#159D67')
  assert.equal(touched[0].customCategory?.color, '#159D67')
  assert.equal(touched[0].customCategory?.icon, 'desk-monitor-shelf')
  await h.api.reloadCustomCategoriesFromDisk()
  assert.equal(h.render().categories[0].color, '#159D67')
  const renamed = await h.render().update(figure.id, { name: '棚', icon: saved.icon })
  assert.equal(renamed.color, saved.color)
})

test('新しいジャンルの自由色も端末に保存する', async () => {
  const h = harness()
  await h.render().add('棚', 'desk-monitor-shelf', '#bd538a')
  assert.equal(h.disk()[0].color, '#BD538A')
})

test('初回読み込み直後の作成で保存済みの同名ジャンルを重複させない', async () => {
  const h = harness({ initial: [figure] })
  const category = await h.render().add(figure.name, figure.icon)
  assert.equal(category.id, figure.id)
  assert.equal(h.disk().length, 1)
})

test('同じレンダーから同時に作成しても同名ジャンルは1件だけ保存する', async () => {
  const h = harness()
  const hook = h.render()
  const [first, second] = await Promise.all([hook.add(figure.name, figure.icon), hook.add(figure.name, figure.icon)])
  assert.equal(first.id, second.id)
  assert.equal(h.disk().length, 1)
})

test('保存失敗を呼び出し元へ返し、作成を成功扱いにしない', async () => {
  const h = harness({ write: async () => { throw new Error('disk unavailable') } })
  await assert.rejects(h.render().add(figure.name, figure.icon), /disk unavailable/)
  assert.equal(h.render().categories.length, 0)
  assert.equal(h.disk().length, 0)
})

test('読み込み失敗中は削除を成功扱いにせず保存済みジャンルを残す', async () => {
  const h = harness({ initial: [figure], read: async () => { throw new Error('read unavailable') } })
  await assert.rejects(h.render().remove(figure.id))
  assert.equal(h.disk()[0].id, figure.id)
  assert.equal(h.writes.length, 0)
})

test('ログアウト前の読み込みが遅れて完了しても古いジャンルを復活させない', async () => {
  const read = deferred<string | null>()
  const h = harness({ read: () => read.promise })
  h.render()
  const clear = h.api.clearCustomCategoriesCache()
  read.resolve(JSON.stringify([figure]))
  await clear
  await flush()
  assert.equal(h.render().categories.length, 0)
})

test('ログアウト前の保存を待ち、消去後へ書き戻さない', async () => {
  const started = deferred<void>()
  const finish = deferred<void>()
  const h = harness({ write: async () => { started.resolve(); await finish.promise } })
  const saving = h.render().add(figure.name, figure.icon)
  await started.promise
  let cleared = false
  const clear = Promise.resolve(h.api.clearCustomCategoriesCache()).then(() => { cleared = true })
  await flush()
  assert.equal(cleared, false)
  finish.resolve()
  await Promise.allSettled([saving, clear])
  assert.equal(h.render().categories.length, 0)
})

test('復元時の再読み込みは古い読み込みを使い回さない', async () => {
  const oldRead = deferred<string | null>()
  let reads = 0
  const h = harness({ read: () => ++reads === 1 ? oldRead.promise : Promise.resolve(JSON.stringify([figure])) })
  h.render()
  const reload = h.api.reloadCustomCategoriesFromDisk()
  oldRead.resolve('[]')
  await reload
  await flush()
  assert.equal(h.render().categories[0]?.id, figure.id)
})

test('保存が失敗しても次の作成は再試行できる', async () => {
  let attempts = 0
  const h = harness({ write: async () => { if (++attempts === 1) throw new Error('disk unavailable') } })
  const hook = h.render()
  await assert.rejects(hook.add(figure.name, figure.icon))
  await hook.add(figure.name, figure.icon)
  assert.equal(h.disk().length, 1)
})

test('ジャンルの保存停止で待機を解除し、期限切れの後続作成を遅れて実行しない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const gate = deferred<void>()
  const h = harness({ write: () => gate.promise })
  const first = assert.rejects(h.render().add('最初', 'robot'), /STORAGE_OPERATION_PENDING/)
  await flush()
  t.mock.timers.tick(5_000)
  await first
  const expired = assert.rejects(h.render().add('期限切れ', 'robot'), /STORAGE_OPERATION_PENDING/)
  await flush()
  t.mock.timers.tick(5_000)
  await expired
  gate.resolve()
  await flush()
  await h.api.flushCustomCategoryPersistence()
  assert.deepEqual(h.disk().map(row => row.name), ['最初'])
  await h.render().add('再試行', 'robot')
  assert.deepEqual(h.disk().map(row => row.name), ['最初', '再試行'])
})
