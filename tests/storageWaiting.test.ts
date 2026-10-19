import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../src/utils/networkError'
import { splitGadgetsByTrash } from '../src/utils/gadgetTrash'
import { localizedErrorMessage } from '../src/utils/localizedError'
import { PLAN_LIMITS } from '../src/constants/plans'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function storage(kind: 'plans' | 'gadgets') {
  let saved: any[] = [{ id: 'original', name: 'original', createdAt: '2026-10-08', selectedGadgetIds: [], ports: [] }]
  const wiringResult = { connections: [], requiredCables: [], warnings: [] }
  if (kind === 'plans') saved[0].wiringResult = wiringResult
  let planLimit = 3
  let subscriptionLoading = false
  const state = { gate: Promise.resolve(), read: Promise.resolve(), fail: false, writes: 0 }
  const module = { exports: {} as any }
  const load = async () => { await state.read; return structuredClone(saved) }
  const save = async (next: any[]) => {
    state.writes++
    await state.gate
    if (state.fail) throw new Error('disk failed')
    saved = structuredClone(next)
  }
  const code = ts.transpileModule(readFileSync(`src/hooks/${kind === 'plans' ? 'usePlans' : 'useGadgets'}.ts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, Error, Date, require: (id: string) => {
    if (id === 'react') return { useState: (initial: unknown) => [initial, () => {}], useEffect: () => {}, useCallback: (fn: unknown) => fn, useRef: (initial: unknown) => ({ current: initial }) }
    if (id.endsWith('/useEntitlement')) return { useEntitlement: () => ({ getLimit: () => planLimit, isLoading: subscriptionLoading }) }
    if (id.endsWith('/plans')) return { PLAN_LIMITS }
    if (id.endsWith('/planStore')) return { loadPlans: load, savePlans: save }
    if (id.endsWith('/gadgetStore')) return { loadGadgets: load, saveGadgets: save, loadFolders: async () => [], saveFolders: async () => {}, FOLDER_PALETTE: [] }
    if (id.endsWith('/networkError')) return { STORAGE_TIMEOUT_MS, withTimeout }
    if (id.endsWith('/gadgetTrash')) return { splitGadgetsByTrash }
    if (id.endsWith('/analytics')) return { analytics: { track() {}, error() {} }, EVENTS: {} }
    if (id.endsWith('/mapLayoutCache')) return { evictPlanLayoutCache() {}, restorePlanLayoutCache() {} }
    if (id.endsWith('/deskTimeline')) return { localDateKey: () => '2026-10-08' }
    throw new Error(id)
  } })
  const api = module.exports
  return {
    state, saved: () => saved, setPlanLimit: (limit: number) => { planLimit = limit },
    setSubscriptionLoading: (loading: boolean) => { subscriptionLoading = loading },
    addPlan: (id: string, beforeAdd?: () => Promise<void>, isShared = false, unfinished = false) => api.usePlans().add({ id, name: id, createdAt: '2026-10-14', selectedGadgetIds: [], placements: [], isShared, wiringResult: unfinished ? undefined : wiringResult }, beforeAdd),
    completePlan: (id: string) => api.usePlans().updateWith(id, (plan: any) => ({ ...plan, wiringResult })),
    removePlan: (id: string) => api.usePlans().remove(id, { awaitPersistence: true }),
    preload: () => kind === 'plans' ? api.preloadPlans() : api.preloadGadgets(),
    restore: (id: string) => kind === 'plans'
      ? api.usePlans().restore({ id, name: id, createdAt: '2026-10-08', selectedGadgetIds: [], ports: [] })
      : api.useGadgets().restoreMany([{ id, name: id, createdAt: '2026-10-08', ports: [] }]),
    clear: () => kind === 'plans' ? api.clearPlansCache() : api.clearGadgetsCache(),
    flush: () => kind === 'plans' ? api.flushPlanPersistence() : api.flushGadgetPersistence(),
    toggleFavorite: () => api.useGadgets().toggleFavorite('original'),
    togglePinned: () => api.usePlans().togglePinned('original'),
    readPlans: () => api.usePlans().plans,
    setFavorite: (favorite: boolean, id = 'original') => api.useGadgets().setFavorite(id, favorite),
    setDisposedAt: (disposedAt?: string) => api.useGadgets().setDisposedAt('original', disposedAt),
    readGadgets: () => api.useGadgets().gadgets,
    updateGadget: (gadget: any) => api.useGadgets().update(gadget),
    removeGadget: () => api.useGadgets().remove('original'),
    reloadGadgets: () => api.reloadGadgetsFromDisk(),
  }
}

test('処分状態は保存完了を待って再読み込み後も残り、取り消しでお気に入りや使用履歴を失わない', async () => {
  const h = storage('gadgets')
  await h.preload()
  await h.updateGadget({ ...h.readGadgets()[0], removedAt: '2026-09-01', favorite: true })
  await h.flush()
  const gate = deferred()
  h.state.gate = gate.promise
  const disposedAt = '2026-10-17T01:00:00.000Z'
  let completed = false
  const disposal = h.setDisposedAt(disposedAt).then(() => { completed = true })
  await flush()
  assert.equal(completed, false)
  assert.equal(h.readGadgets()[0].disposedAt, disposedAt)
  gate.resolve()
  await disposal
  await h.reloadGadgets()
  assert.equal(h.readGadgets()[0].disposedAt, disposedAt)
  await Promise.all([h.setFavorite(false), h.setDisposedAt(undefined)])
  assert.equal(h.saved()[0].disposedAt, undefined)
  assert.equal(h.saved()[0].favorite, undefined)
  assert.equal(h.saved()[0].removedAt, '2026-09-01')
  h.state.fail = true
  await assert.rejects(h.setDisposedAt(disposedAt), /disk failed/)
  assert.equal(h.readGadgets()[0].disposedAt, undefined)
  assert.equal(h.readGadgets()[0].removedAt, '2026-09-01')
})

test('デスク作成は保存完了を待ち、保存失敗を作成成功として扱わない', async () => {
  const h = storage('plans')
  await h.preload()
  const gate = deferred()
  h.state.gate = gate.promise
  let completed = false
  const adding = h.addPlan('new').then(() => { completed = true })
  await flush()
  assert.equal(completed, false)
  assert.deepEqual(h.saved().map(row => row.id), ['original'])
  gate.resolve()
  await adding
  assert.deepEqual(h.saved().map(row => row.id), ['original', 'new'])
  h.state.fail = true
  await assert.rejects(h.addPlan('failed'), /disk failed/)
  assert.deepEqual(h.saved().map(row => row.id), ['original', 'new'])
})

test('作成が同時に走っても保存時の最新件数で3件を守り、拒否時は機材を作らない', async () => {
  const h = storage('plans')
  await h.preload()
  await h.addPlan('second')
  let prepared = 0
  const add = (id: string) => h.addPlan(id, async () => { prepared++ })
  const results = await Promise.allSettled([add('third'), add('fourth')])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.match(String((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /DESK_LIMIT_REACHED/)
  assert.deepEqual(h.saved().map(row => row.id), ['original', 'second', 'third'])
  assert.equal(prepared, 1)
  await h.addPlan('shared', undefined, true)
  assert.equal(h.saved().filter(row => !row.isShared).length, 3)
})

test('既に上限を超えたデスクを保持し、同一IDの再試行とProの作成を区別する', async () => {
  const h = storage('plans')
  h.setPlanLimit(-1)
  await h.preload()
  for (let n = 2; n <= 7; n++) await h.addPlan(`desk-${n}`)
  h.setPlanLimit(3)
  let prepared = 0
  await assert.rejects(h.addPlan('eighth', async () => { prepared++ }), /DESK_LIMIT_REACHED/)
  await h.addPlan('desk-7', async () => { prepared++ })
  assert.equal(prepared, 0)
  assert.equal(h.saved().length, 7)
  h.setPlanLimit(-1)
  await h.addPlan('eighth')
  assert.equal(h.saved().length, 8)
})

test('課金確認中は3件目まで保存でき、4件目は権利確定まで作成しない', async () => {
  const h = storage('plans')
  await h.preload()
  await h.addPlan('second')
  h.setSubscriptionLoading(true)
  h.setPlanLimit(-1)
  await h.addPlan('third')
  let prepared = 0
  await assert.rejects(h.addPlan('fourth', async () => { prepared++ }), /DESK_ENTITLEMENT_PENDING/)
  assert.equal(prepared, 0)
  assert.equal(h.saved().length, 3)
  h.setSubscriptionLoading(false)
  h.setPlanLimit(3)
  await assert.rejects(h.addPlan('fourth', async () => { prepared++ }), /DESK_LIMIT_REACHED/)
  h.setPlanLimit(-1)
  await h.addPlan('fourth', async () => { prepared++ })
  assert.equal(prepared, 1)
  assert.equal(h.saved().length, 4)
})

test('未完成デスクの同時作成は1件だけ保存し、拒否した処理の機材・写真は作らない', async () => {
  for (const limit of [3, -1]) {
    const h = storage('plans')
    h.setPlanLimit(limit)
    await h.preload()
    let prepared = 0
    const create = (id: string) => h.addPlan(id, async () => { prepared++ }, false, true)
    const results = await Promise.allSettled([create('unfinished-a'), create('unfinished-b')])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.match(String((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /DESK_SETUP_IN_PROGRESS/)
    assert.equal(h.saved().filter(plan => !plan.wiringResult).length, 1)
    assert.equal(prepared, 1)
    await create('unfinished-a')
    assert.equal(prepared, 1, '同一IDの保存再試行は新しいデスクを作らない')
    await h.completePlan('unfinished-a')
    await h.flush()
    await create('unfinished-b')
    assert.equal(h.saved().filter(plan => !plan.wiringResult).length, 1)
    assert.equal(prepared, 2, '完成後は次の1件を作成できる')
  }
})

test('共有デスクは未完成の制限に含めず、未完成の保存失敗後も再試行できる', async () => {
  const h = storage('plans')
  await h.preload()
  await h.addPlan('shared', undefined, true, true)
  h.state.fail = true
  await assert.rejects(h.addPlan('failed', undefined, false, true), /disk failed/)
  h.state.fail = false
  await h.addPlan('unfinished', undefined, false, true)
  assert.equal(h.saved().filter(plan => !plan.isShared && !plan.wiringResult).length, 1)
})

test('旧版の未完成デスクが3件あっても保持し、上限のまま再開・完成・削除できる', async () => {
  const h = storage('plans')
  await h.preload()
  await h.removePlan('original')
  for (const id of ['legacy-a', 'legacy-b', 'legacy-c']) await h.restore(id)
  assert.equal(h.saved().length, 3)
  await h.addPlan('legacy-b', undefined, false, true)
  await assert.rejects(h.addPlan('new', undefined, false, true), /DESK_SETUP_IN_PROGRESS/)
  assert.equal(h.saved().length, 3)
  await h.completePlan('legacy-a')
  await h.completePlan('legacy-b')
  await h.flush()
  assert.equal(h.saved().length, 3)
  await h.removePlan('legacy-c')
  await h.addPlan('new', undefined, false, true)
  assert.equal(h.saved().length, 3)
  assert.equal(h.saved().filter(plan => !plan.wiringResult).length, 1)
})

test('保存タイムアウト後に再試行しても、遅れて保存された同じデスクを重複追加しない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = storage('plans')
  await h.preload()
  const gate = deferred()
  h.state.gate = gate.promise
  const pending = assert.rejects(h.addPlan('retry'), /STORAGE_OPERATION_PENDING/)
  await flush()
  t.mock.timers.tick(5_000)
  await pending
  const retry = h.addPlan('retry')
  gate.resolve()
  await retry
  assert.deepEqual(h.saved().map(row => row.id), ['original', 'retry'])
})

test('持ち物の星は保存・再読み込みでき、連続操作でも最新値から付け外しする', async () => {
  const h = storage('gadgets')
  await h.preload()
  await h.toggleFavorite()
  await h.flush()
  assert.equal(h.saved()[0].favorite, true)
  assert.equal(h.saved()[0].name, 'original')
  await h.clear()
  await h.reloadGadgets()
  await h.toggleFavorite()
  await h.flush()
  assert.equal(h.saved()[0].favorite, undefined)
  await Promise.all([h.toggleFavorite(), h.toggleFavorite()])
  await h.flush()
  assert.equal(h.saved()[0].favorite, undefined)
})

test('ピン留めは保存完了を待ち、保存失敗を画面へ返して元の状態へ戻る', async () => {
  const h = storage('plans')
  await h.preload()
  const gate = deferred()
  h.state.gate = gate.promise
  let completed = false
  const pending = h.togglePinned().then(() => { completed = true })
  await flush()
  assert.equal(completed, false)
  assert.equal(h.readPlans()[0].favorite, true)
  gate.resolve()
  await pending
  assert.equal(h.saved()[0].favorite, true)
  h.state.fail = true
  await assert.rejects(h.togglePinned(), /disk failed/)
  assert.equal(h.readPlans()[0].favorite, true)
})

test('星の変更は全画面へ即時に反映し、保存完了まで成功を返さない', async () => {
  const h = storage('gadgets')
  await h.preload()
  const gate = deferred()
  h.state.gate = gate.promise
  let completed = false
  const pending = h.toggleFavorite().then((gadget: any) => {
    completed = true
    assert.equal(gadget.favorite, true)
  })
  await flush()
  assert.equal(completed, false)
  assert.equal(h.readGadgets()[0].favorite, true)
  assert.equal(h.saved()[0].favorite, undefined)
  gate.resolve()
  await pending
  assert.equal(h.saved()[0].favorite, true)
})

test('星の保存失敗は呼び出し元へ返り、解除も取り消しも保存済みの値へ戻る', async () => {
  const h = storage('gadgets')
  await h.preload()
  await h.setFavorite(true)
  h.state.fail = true
  await assert.rejects(h.toggleFavorite(), /disk failed/)
  assert.equal(h.readGadgets()[0].favorite, true)
  h.state.fail = false
  await h.toggleFavorite()
  h.state.fail = true
  await assert.rejects(h.setFavorite(true), /disk failed/)
  assert.equal(h.readGadgets()[0].favorite, undefined)
})

test('お気に入りの取り消しは再実行しても星を維持し、その間の編集や削除を巻き戻さない', async () => {
  const h = storage('gadgets')
  await h.preload()
  await h.setFavorite(true)
  await h.toggleFavorite()
  await h.updateGadget({ ...h.readGadgets()[0], name: 'edited' })
  await h.setFavorite(true)
  await h.setFavorite(true)
  assert.equal(h.readGadgets()[0].favorite, true)
  assert.equal(h.readGadgets()[0].name, 'edited')
  await h.removeGadget()
  await h.setFavorite(true)
  assert.equal(h.readGadgets().length, 0)
  assert.equal(h.saved().length, 0)
})

for (const kind of ['plans', 'gadgets'] as const) {
  test(`${kind}: 保存停止で待機を解除し、期限切れの後続を保存せず、新しい変更を追い越さない`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const h = storage(kind)
    await h.preload()
    const gate = deferred()
    h.state.gate = gate.promise
    const first = assert.rejects(h.restore('first'), /STORAGE_OPERATION_PENDING/)
    await flush()
    t.mock.timers.tick(5_000)
    await first
    const second = assert.rejects(h.restore('expired'), /STORAGE_OPERATION_PENDING/)
    await flush()
    t.mock.timers.tick(5_000)
    await second
    assert.equal(h.state.writes, 1)
    assert.deepEqual(h.saved().map(row => row.id), ['original'])
    gate.resolve()
    await flush()
    await h.restore('new')
    assert.deepEqual(h.saved().map(row => row.id).sort(), ['first', 'new', 'original'])
    assert.equal(h.state.writes, 2)
  })

  test(`${kind}: バックアップ前の保存待ちとキャッシュ消去も期限を設け、実際の保存キューは保持する`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const h = storage(kind)
    await h.preload()
    const gate = deferred()
    h.state.gate = gate.promise
    const write = assert.rejects(h.restore('pending'), /STORAGE_OPERATION_PENDING/)
    await flush()
    const waiting = assert.rejects(h.flush(), /timed out/)
    const clearing = assert.rejects(h.clear(), /timed out/)
    t.mock.timers.tick(5_000)
    await Promise.all([write, waiting, clearing])
    gate.resolve()
    await flush()
    await h.flush()
    assert.equal(h.state.writes, 1)
  })

  test(`${kind}: 保存失敗後の読み戻しが止まってもキューを復帰させ、次の保存を受け付ける`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const h = storage(kind)
    await h.preload()
    h.state.fail = true
    h.state.read = new Promise(() => {})
    const failed = assert.rejects(h.restore('failed'), /STORAGE_OPERATION_PENDING/)
    await flush()
    t.mock.timers.tick(5_000)
    await failed
    await flush()
    h.state.fail = false
    h.state.read = Promise.resolve()
    await h.restore('retry')
    assert.deepEqual(h.saved().map(row => row.id).sort(), ['original', 'retry'])
  })
}

test('端末保存の停止は日本語・英語とも通信エラーと取り違えない案内にする', () => {
  assert.match(localizedErrorMessage('STORAGE_OPERATION_PENDING', 'ja'), /端末の保存処理/)
  assert.match(localizedErrorMessage('STORAGE_OPERATION_PENDING', 'en'), /Device storage/)
})
