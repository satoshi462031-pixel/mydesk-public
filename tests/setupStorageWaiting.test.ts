import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as drafts from '../src/utils/firstSetupResume'
import { withTimeout } from '../src/utils/networkError'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function storage(file = 'firstSetupStore') {
  const values = new Map<string, string>()
  const state = { read: Promise.resolve(), write: Promise.resolve(), writes: 0 }
  const api: Record<string, any> = {}
  runInNewContext(ts.transpileModule(readFileSync(`src/store/${file}.ts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: api, require: (id: string) => {
    if (id.endsWith('/firstSetupResume')) return drafts
    if (id.endsWith('/networkError')) return { STORAGE_TIMEOUT_MS: 20, withTimeout }
    if (id === '@react-native-async-storage/async-storage') return { default: {
      getItem: async (key: string) => { await state.read; return values.get(key) ?? null },
      setItem: async (key: string, value: string) => { state.writes++; await state.write; values.set(key, value) },
      removeItem: async (key: string) => { state.writes++; await state.write; values.delete(key) },
    } }
    throw new Error(id)
  } })
  const settled = async (work: Promise<unknown>) => Promise.race([
    work.then(value => ({ status: 'fulfilled', value }), () => ({ status: 'rejected' })),
    new Promise<{ status: string }>(resolve => setTimeout(() => resolve({ status: 'stalled' }), 100)),
  ])
  return { api, state, values, settled }
}

test('再開位置の読み込み停止で新規作成の確認を待ち続けず、復帰後は再読込できる', async () => {
  const h = storage()
  const gate = deferred<void>()
  h.state.read = gate.promise
  const loading = h.api.loadFirstSetupDraft()
  try {
    const result = await h.settled(loading)
    assert.equal(result.status, 'fulfilled')
    assert.equal('value' in result && result.value, null)
    assert.equal(h.api.peekFirstSetupDraft(), undefined)
  } finally { gate.resolve() }
  await loading
  h.values.set('@first_setup_draft_v1', JSON.stringify({ screen: 'DeskPlacement', planId: 'desk', createdAt: '2026-10-19' }))
  assert.equal((await h.api.loadFirstSetupDraft()).planId, 'desk')
})

test('再開位置の保存停止は配置への遷移を解放し、後続の保存と破棄は実際の書込み順を守る', async () => {
  const h = storage()
  const gate = deferred<void>()
  h.state.write = gate.promise
  const saving = h.api.saveFirstSetupDraft({ screen: 'DeskPlacement', planId: 'desk', createdAt: '2026-10-19' })
  try {
    assert.equal((await h.settled(saving)).status, 'rejected')
    assert.equal(h.api.peekFirstSetupDraft().screen, 'DeskPlacement')
    const next = h.api.saveFirstSetupDraft({ screen: 'PhotoFill', planId: 'desk' })
    const outcomes = await Promise.all([
      h.settled(next), h.settled(h.api.clearFirstSetupDraft()), h.settled(h.api.clearFirstSetupDraftCache()),
    ])
    assert.ok(outcomes.every(result => result.status === 'rejected'))
    assert.equal(h.state.writes, 1)
  } finally { gate.resolve() }
  await saving.catch(() => {})
  await flush()
  await h.api.flushFirstSetupDraftPersistence()
  assert.equal(h.values.has('@first_setup_draft_v1'), false)
  await h.api.saveFirstSetupDraft({ screen: 'PhotoFill', planId: 'recovered', createdAt: '2026-10-19' })
  assert.equal(JSON.parse(h.values.get('@first_setup_draft_v1')!).planId, 'recovered')
})

test('初回読込の停止中に入力した下書きはタイムアウト時も優先し、読み込み復帰を待たず保存を進める', async () => {
  const h = storage()
  const gate = deferred<void>()
  h.state.read = gate.promise
  const loading = h.api.loadFirstSetupDraft()
  const draft = { screen: 'TemplateDetail', templateId: 'composition', purposes: ['work'] }
  const saving = h.api.saveFirstSetupDraft(draft)
  const savingOutcome = h.settled(saving)
  try {
    const result = await h.settled(loading)
    assert.equal(result.status, 'fulfilled')
    assert.deepEqual(JSON.parse(JSON.stringify('value' in result && result.value)), draft)
    assert.notEqual((await savingOutcome).status, 'stalled')
    await flush()
    assert.equal(JSON.parse(h.values.get('@first_setup_draft_v1')!).templateId, 'composition')
  } finally { gate.resolve() }
  await saving.catch(() => {})
})

test('商品の下書き読込・保存・削除の停止も待機を解除し、入力画面を開き直せる', async () => {
  for (const operation of ['loadProductFillDraft', 'saveProductFillDraft', 'clearProductFillDraft']) {
    const h = storage()
    const gate = deferred<void>()
    h.state.read = gate.promise
    h.state.write = gate.promise
    const work = h.api[operation]('desk', { values: { gadget: 'Camera' }, picked: {} })
    try {
      assert.equal((await h.settled(work)).status, operation === 'loadProductFillDraft' ? 'fulfilled' : 'rejected', operation)
    } finally { gate.resolve() }
    await work.catch(() => {})
  }
})

test('機材詳細から戻った後の下書きID整理が停止しても、作成の保存待ちを解除できる', async () => {
  for (const operation of ['trackTemplateDraftGadget', 'untrackTemplateDraftGadgets']) {
    const h = storage('templateDraftGadgets')
    const gate = deferred<void>()
    h.state.read = gate.promise
    const work = h.api[operation](operation === 'trackTemplateDraftGadget' ? 'gadget' : ['gadget'])
    try { assert.equal((await h.settled(work)).status, 'rejected', operation) }
    finally { gate.resolve() }
    await work.catch(() => {})
  }
})
