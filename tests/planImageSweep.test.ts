import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const DIR = 'file:///Documents/plan_images/'
const DAY = 24 * 60 * 60 * 1000

function harness(files: string[], stored: Record<string, string>, options: { failRead?: boolean } = {}) {
  const store = new Map(Object.entries(stored))
  const present = new Set(files)
  const source = ts.transpileModule(readFileSync('src/services/planImageSweep.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: any = {}
  runInNewContext(source, { exports, Promise, JSON, Object, require: (id: string) => {
    if (id === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
      getAllKeys: async () => [...store.keys()],
      multiGet: async (keys: string[]) => { if (options.failRead) throw new Error('storage unavailable'); return keys.map(key => [key, store.get(key) ?? null]) },
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value) },
      removeItem: async (key: string) => { store.delete(key) },
    } }
    if (id === 'expo-file-system/legacy') return {
      readDirectoryAsync: async () => [...present],
      deleteAsync: async (uri: string) => { present.delete(uri.slice(DIR.length)) },
    }
    if (id === '../utils/planImages') return { PLAN_IMAGE_DIR: DIR }
    throw new Error(id)
  } })
  return { sweep: exports.sweepUnreferencedPlanImages as (now: number) => Promise<number>, present, store }
}

const plans = (...names: string[]) => JSON.stringify([{ id: 'p1', images: names.map(name => `plan_images/${name}`) }])

test('どこからも参照されない写真は、24時間空けた2回目の掃除で縮小版ごと消す', async () => {
  const h = harness(['p1_a.jpg', 'p1_a_thumb.jpg', 'gone_b.jpg', 'gone_b_thumb.jpg', 'gone_b_md.jpg'], { '@desk_plans': plans('p1_a.jpg') })
  assert.equal(await h.sweep(0), 0)
  assert.equal(h.present.size, 5)
  assert.equal(await h.sweep(DAY - 1), 0)
  assert.equal(await h.sweep(DAY), 3)
  assert.deepEqual([...h.present].sort(), ['p1_a.jpg', 'p1_a_thumb.jpg'])
})

test('取り消し用の控え・下書き・旧形式の絶対パスなど、どこかに名前があれば残す', async () => {
  const h = harness(['undo.jpg', 'draft.jpg', 'legacy.jpg', 'pending.jpg'], {
    '@backup_restore_point': JSON.stringify({ entries: [['@desk_plans', plans('undo.jpg')]] }),
    '@first_setup_draft_v1': JSON.stringify({ images: ['plan_images/draft.jpg'] }),
    '@desk_plans': JSON.stringify([{ images: ['file:///var/mobile/Containers/Data/Application/OLD/Documents/plan_images/legacy.jpg'] }]),
    '@pending_desk_cleanups_v1': JSON.stringify({ p9: { images: ['plan_images/pending.jpg'], queuedAt: '2026-10-14T00:00:00Z' } }),
  })
  await h.sweep(0)
  await h.sweep(2 * DAY)
  assert.equal(h.present.size, 4)
})

test('1回目のあとで参照されるようになった写真（保存が遅れた取り込み・複製）は消さない', async () => {
  const h = harness(['late.jpg'], {})
  await h.sweep(0)
  h.store.set('@desk_plans', plans('late.jpg'))
  await h.sweep(2 * DAY)
  assert.equal(h.present.has('late.jpg'), true)
  assert.equal(h.store.has('@plan_image_sweep_candidates_v1'), false)
})

test('保存値を読めなければ1枚も消さない（全部が孤児に見えるため）', async () => {
  const h = harness(['a.jpg'], { '@plan_image_sweep_candidates_v1': JSON.stringify({ 'a.jpg': 0 }) }, { failRead: true })
  await assert.rejects(h.sweep(2 * DAY), /storage unavailable/)
  assert.equal(h.present.has('a.jpg'), true)
})
