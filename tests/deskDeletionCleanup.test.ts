import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function load(path: string, require: (id: string) => unknown) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: any = {}
  runInNewContext(source, { exports, require, Promise, Date, JSON, Object, Array })
  return exports
}

function harness(options: { plans?: Set<string>; failPublished?: boolean } = {}) {
  const store = new Map<string, string>()
  const calls: string[] = []
  const plans = options.plans ?? new Set<string>()
  const cleanup = load('src/services/deskDeletionCleanup.ts', (id) => {
    if (id === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value) },
      removeItem: async (key: string) => { calls.push('remove:' + key); store.delete(key) },
    } }
    if (id === './publishService') return { deletePublishedPlanData: async (planId: string) => { calls.push('published:' + planId); if (options.failPublished) throw new Error('offline') } }
    if (id === '../utils/planImages') return { deletePlanImages: async (planId: string, images: string[]) => { calls.push(`images:${planId}:${images.join(',')}`) } }
    if (id === '../store/firstSetupStore') return { clearProductFillDraft: async (planId: string) => { calls.push('draft:' + planId) } }
    if (id === '../store/planStore') return { getPlanById: async (planId: string) => plans.has(planId) ? { id: planId } : undefined }
    if (id === '../utils/deskCompletionPrompt') return { forgetDeskCompletionPrompt: async (planId: string) => { calls.push('prompt:' + planId) } }
    if (id === '../utils/wiringSuggestionDismissal') return { forgetDismissedSuggestions: async (planId: string) => { calls.push('dismissed:' + planId) } }
    throw new Error(id)
  })
  const pending = () => Object.keys(JSON.parse(store.get('@pending_desk_cleanups_v1') ?? '{}'))
  return { cleanup, calls, store, plans, pending }
}

const LATER = Date.now() + 120_000

test('期限前にアプリを終了して後始末が走らなかった削除は、次に開いたときに公開データ・写真・記録まで消す', async () => {
  const h = harness()
  await h.cleanup.queueDeskCleanup('p1', ['file:///photo.jpg'])
  await h.cleanup.resumePendingDeskCleanups(LATER)
  assert.deepEqual(h.calls.sort(), ['dismissed:p1', 'draft:p1', 'images:p1:file:///photo.jpg', 'prompt:p1', 'published:p1', 'remove:@desk_history:p1'])
  assert.deepEqual(h.pending(), [])
})

test('公開データを消せなかった（圏外など）ときは控えを残し、次回にやり直す', async () => {
  const h = harness({ failPublished: true })
  await h.cleanup.queueDeskCleanup('p1', [])
  await h.cleanup.resumePendingDeskCleanups(LATER)
  assert.deepEqual(h.pending(), ['p1'])
})

test('Undo で戻したデスクは消さず、控えだけ片付ける', async () => {
  const h = harness({ plans: new Set(['p1']) })
  await h.cleanup.queueDeskCleanup('p1', ['file:///photo.jpg'])
  await h.cleanup.resumePendingDeskCleanups(LATER)
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.pending(), [])
})

test('Undo の猶予中の削除には手を出さない', async () => {
  const h = harness()
  await h.cleanup.queueDeskCleanup('p1', [])
  await h.cleanup.resumePendingDeskCleanups(Date.now())
  assert.deepEqual(h.calls, [])
  assert.deepEqual(h.pending(), ['p1'])
})

test('後始末が済むか取り消せば控えは消え、ほかのデスクの控えは残る', async () => {
  const h = harness()
  await Promise.all([h.cleanup.queueDeskCleanup('p1', []), h.cleanup.queueDeskCleanup('p2', []), h.cleanup.queueDeskCleanup('p3', [])])
  assert.deepEqual(h.pending().sort(), ['p1', 'p2', 'p3'])
  await h.cleanup.runDeskCleanup('p1', [])
  await h.cleanup.cancelDeskCleanup('p2')
  assert.deepEqual(h.pending(), ['p3'])
})
