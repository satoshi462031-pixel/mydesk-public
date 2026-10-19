import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { Gadget, MapConnection } from '../src/types'
import { computeMapLayout, MapLayout } from '../src/utils/connectionMapLayout'
import { appendTodayPage, buildTimeline, localDateKey } from '../src/utils/deskTimeline'
import { buildHistoryReplacementLayoutPlan, restoreHistoryReplacementLayout } from '../src/utils/historyReplacement'
import { compactHistoryLayout, HISTORY_LAYOUT_CACHE_KEY, HistoryLayoutCache, restoreCompactHistoryLayout } from '../src/utils/historyLayoutCache'
import { LAYOUT_VERSION, makeLayoutInputKey } from '../src/utils/mapLayoutCache'
import { localUserDataKeys } from '../src/utils/localUserDataKeys'
import { computeHistoryLayouts } from '../src/utils/historyLayouts'

const gadget: Gadget = { id: 'g', name: 'PC', category: 'PC', ports: [], createdAt: '', price: 10 }
const attached: Gadget = { ...gadget, id: 'pen', category: 'Accessory' }
const connection: MapConnection = { id: 'hist-g~g|USB_C', fromGadgetId: 'g', toGadgetId: 'g', cableType: 'USB_C', origin: 'auto', confirmed: true }
const node = { id: 'g', gadget, attached: [attached], tier: 1, x: 0, y: 0, w: 10, h: 10, cx: 5, cy: 5, isWall: false }
const layout: MapLayout = { nodes: [node], edges: [{ from: node, to: node, conn: connection, points: [{ x: 5, y: 5 }] }], width: 10, height: 10, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }
const key = makeLayoutInputKey([gadget], [connection], [], {}, {}) + '||history-replacements:'

function memoryStorage(initial: string | null = null) {
  let raw = initial
  return {
    get raw() { return raw },
    async getItem() { return raw },
    async setItem(_key: string, value: string) { raw = value },
    async removeItem() { raw = null },
  }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

test('再起動後に線の端点・内包ノードを復元し、最新の商品・接続情報へ差し替える', async () => {
  const storage = memoryStorage()
  const first = await new HistoryLayoutCache(async () => storage).open('p', 'month', LAYOUT_VERSION)
  first.set(key, layout)
  await first.save()
  const restarted = await new HistoryLayoutCache(async () => storage).open('p', 'month', LAYOUT_VERSION)
  const current = { ...gadget, price: 100 }
  const currentPen = { ...attached, price: 200 }
  const currentConnection = { ...connection, label: 'new' }
  const restored = restarted.get(key, [current, currentPen], [currentConnection])!
  assert.deepEqual(restored.nodes[0].gadget, current)
  assert.deepEqual(restored.nodes[0].attached, [currentPen])
  assert.equal(restored.edges[0].from, restored.nodes[0])
  assert.equal(restored.edges[0].to, restored.nodes[0])
  assert.equal(restored.edges[0].conn, currentConnection)
  assert.deepEqual(restored.edges[0].points, layout.edges[0].points)
})

test('デモの全粒度で買い替え・擬似ノード・補助線を含めて保存前後の図が一致する', async () => {
  for (const demo of buildAllDemoDesks('ja')) {
    for (const grain of ['day', 'month', 'year'] as const) {
      const events = appendTodayPage(buildTimeline(demo.gadgets, demo.plan, 'ja', grain), localDateKey())
      for (const e of events) {
        const rp = buildHistoryReplacementLayoutPlan(e.inGadgets, e.outGadgets, e.connections, e.renderGadgets, e.renderConnections)
        const raw = await computeMapLayout(rp.gadgets, rp.connections, demo.plan.placements, {}, {}, !!demo.plan.templateId)
        const expected = restoreHistoryReplacementLayout(raw, rp)
        const restored = restoreCompactHistoryLayout(JSON.parse(JSON.stringify(compactHistoryLayout(expected))))
        // JSONではundefinedの項目が省略されるが、描画に使う値は変わらない。
        assert.deepEqual(JSON.parse(JSON.stringify(restored)), JSON.parse(JSON.stringify(expected)))
      }
    }
  }
})

test('日付が変わっても同じ入力を再利用し、変更した配置・粒度・版・買い替えキーは当たらない', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  const month = await cache.open('p', 'month', LAYOUT_VERSION)
  month.set(key, layout)
  await month.save()
  const nextDay = await new HistoryLayoutCache(async () => storage).open('p', 'month', LAYOUT_VERSION)
  assert.ok(nextDay.get(key, [], []))
  const changed = makeLayoutInputKey([gadget], [connection], [], { g: { dx: 1, dy: 0 } }, {})
  assert.equal(nextDay.get(changed, [], []), null)
  assert.equal(nextDay.get(key + 'different-replacement', [], []), null)
  assert.equal((await cache.open('p', 'year', LAYOUT_VERSION)).get(key, [], []), null)
  assert.equal((await new HistoryLayoutCache(async () => storage).open('p', 'month', LAYOUT_VERSION + 1)).get(key, [], []), null)
})

test('壊れたJSON・参照先・数値を破棄し、正常な時点は残す', async () => {
  for (const raw of ['{broken', JSON.stringify({ version: 99, buckets: [] }), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const session = await new HistoryLayoutCache(async () => memoryStorage(raw)).open('p', 'month', LAYOUT_VERSION)
    assert.equal(session.get(key, [], []), null)
  }
  const bad = compactHistoryLayout(layout)
  bad.edges[0].from = 'missing'
  assert.equal(restoreCompactHistoryLayout(bad), null)
  const badNumber = compactHistoryLayout(layout)
  badNumber.nodes[0].cx = NaN
  assert.equal(restoreCompactHistoryLayout(badNumber), null)
  const badAttached = compactHistoryLayout(layout)
  badAttached.nodes[0].attached = ['missing']
  assert.equal(restoreCompactHistoryLayout(badAttached), null)
  const raw = JSON.stringify({ version: 1, layoutVersion: LAYOUT_VERSION, buckets: [{ planId: 'p', grain: 'month', layouts: [
    { key, layout: compactHistoryLayout(layout) }, { key: key + 'bad', layout: bad },
  ] }] })
  const session = await new HistoryLayoutCache(async () => memoryStorage(raw)).open('p', 'month', LAYOUT_VERSION)
  assert.ok(session.get(key, [], []))
  assert.equal(session.get(key + 'bad', [], []), null)
})

test('保存件数・文字数・ノード数の上限を守る', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  for (let p = 0; p < 7; p++) {
    const session = await cache.open(`p${p}`, 'month', LAYOUT_VERSION)
    for (let i = 0; i < 130; i++) session.set(key + i, layout)
    await session.save()
  }
  const payload = JSON.parse(storage.raw!)
  assert.equal(payload.buckets.length, 6)
  assert.ok(payload.buckets.every((b: { layouts: unknown[] }) => b.layouts.length === 128))
  assert.ok(storage.raw!.length <= 2 * 1024 * 1024)
  const session = await cache.open('huge', 'month', LAYOUT_VERSION)
  session.set(key, { ...layout, nodes: Array.from({ length: 101 }, () => node) })
  assert.equal(session.get(key, [], []), null)
  session.set(key, { ...layout, nodes: [{ ...node, gadget: { ...gadget, name: 'x'.repeat(2 * 1024 * 1024) } }] })
  await session.save()
  assert.ok(storage.raw === null || storage.raw.length <= 2 * 1024 * 1024)
})

test('削除・復元とログアウトで、古い準備処理からデータが復活しない', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  const old = await cache.open('p', 'month', LAYOUT_VERSION)
  old.set(key, layout)
  await old.save()
  await cache.evict('p', LAYOUT_VERSION)
  old.set(key, layout)
  await old.save()
  assert.equal((await new HistoryLayoutCache(async () => storage).open('p', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  cache.restore('p')
  const restored = await cache.open('p', 'month', LAYOUT_VERSION)
  restored.set(key, layout)
  await restored.save()
  assert.ok(storage.raw)
  await cache.clear()
  restored.set(key, layout)
  await restored.save()
  assert.equal(storage.raw, null)
  assert.deepEqual(localUserDataKeys([HISTORY_LAYOUT_CACHE_KEY, 'app_theme']), [HISTORY_LAYOUT_CACHE_KEY])
})

test('容量を超える長い履歴でも、枠に収まる最新の時点は保存して復元する', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  const session = await cache.open('p', 'month', LAYOUT_VERSION)
  const large = { ...layout, nodes: [{ ...node, gadget: { ...gadget, name: 'x'.repeat(600_000) } }] }
  for (let i = 0; i < 4; i++) session.set(key + i, large)
  await session.save()
  assert.ok(storage.raw!.length <= 2 * 1024 * 1024)
  const restarted = await new HistoryLayoutCache(async () => storage).open('p', 'month', LAYOUT_VERSION)
  assert.equal(restarted.get(key + '0', [], []), null)
  for (let i = 1; i < 4; i++) assert.ok(restarted.get(key + i, [], []))
})

test('ログアウト中に届いた保存値も読み込まず、書き込み中なら削除完了まで待つ', async () => {
  const saved = memoryStorage()
  const seed = await new HistoryLayoutCache(async () => saved).open('p', 'month', LAYOUT_VERSION)
  seed.set(key, layout)
  await seed.save()
  const oldRaw = saved.raw
  const loaded = deferred<string | null>()
  const reading = deferred<void>()
  const storage = { ...saved, async getItem() { reading.resolve(); return loaded.promise } }
  const cache = new HistoryLayoutCache(async () => storage)
  const opening = cache.open('p', 'month', LAYOUT_VERSION)
  await reading.promise
  await cache.clear()
  loaded.resolve(oldRaw)
  const stale = await opening
  stale.set(key, layout)
  await stale.save()
  assert.equal(stale.get(key, [], []), null)
  assert.equal(saved.raw, null)

  const writing = deferred<void>()
  const finishWrite = deferred<void>()
  const lateStorage = { ...saved, async setItem(k: string, raw: string) {
    writing.resolve(); await finishWrite.promise; await saved.setItem(k, raw)
  } }
  const late = new HistoryLayoutCache(async () => lateStorage)
  const session = await late.open('p', 'month', LAYOUT_VERSION)
  session.set(key, layout)
  const saving = session.save()
  await writing.promise
  const clearing = late.clear()
  finishWrite.resolve()
  await Promise.all([saving, clearing])
  assert.equal(saved.raw, null)
})

test('ストレージの読み書き失敗でも計算結果を使える', async () => {
  const fail = async () => { throw new Error('offline storage') }
  const session = await new HistoryLayoutCache(async () => ({ getItem: fail, setItem: fail, removeItem: fail })).open('p', 'month', LAYOUT_VERSION)
  session.set(key, layout)
  assert.ok(session.get(key, [], []))
  await session.save()
})

test('本番の履歴準備を再起動後は全日キャッシュから作り、途中で閉じた結果は保存しない', async () => {
  const demo = buildAllDemoDesks('ja')[0]
  const storage = memoryStorage()
  const events = appendTodayPage(buildTimeline(demo.gadgets, demo.plan, 'ja', 'month'), localDateKey())
  const cache = new HistoryLayoutCache(async () => storage)
  const before = await computeHistoryLayouts(demo.plan, events, undefined, 'month', {}, cache)
  await cache.flush()
  const restarted = new HistoryLayoutCache(async () => storage)
  const open = restarted.open.bind(restarted)
  let misses = 0
  restarted.open = async (...args) => {
    const session = await open(...args)
    return { ...session, get: (...input) => { const hit = session.get(...input); if (!hit) misses++; return hit } }
  }
  const progress: number[] = []
  const after = await computeHistoryLayouts(demo.plan, events, undefined, 'month', { onProgress: (p) => progress.push(p) }, restarted)
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)))
  assert.equal(misses, 0)
  assert.equal(progress.at(-1), 1)
  await restarted.flush()
  const abortedStorage = memoryStorage()
  const aborted = new HistoryLayoutCache(async () => abortedStorage)
  let cancelled = false
  const result = await computeHistoryLayouts(demo.plan, events, undefined, 'month', {
    cancelled: () => cancelled, onProgress: () => { cancelled = true },
  }, aborted)
  assert.equal(result, null)
  await aborted.flush()
  assert.equal(abortedStorage.raw, null)
})

test('古いブックマークを通常デスク・デモより優先し、再起動後も各粒度の優先を保つ', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  await cache.setBookmarked('saved', true, LAYOUT_VERSION)
  for (const grain of ['month', 'year'] as const) {
    const session = await cache.open('saved', grain, LAYOUT_VERSION)
    session.set(key, layout)
    await session.save()
  }
  for (let i = 0; i < 6; i++) {
    const session = await cache.open(`ordinary-${i}`, 'month', LAYOUT_VERSION)
    session.set(key, layout)
    await session.save()
  }
  const restarted = new HistoryLayoutCache(async () => storage)
  const demo = await restarted.open('demo', 'month', LAYOUT_VERSION)
  demo.set(key, layout)
  await demo.save()
  const again = new HistoryLayoutCache(async () => storage)
  assert.ok((await again.open('saved', 'month', LAYOUT_VERSION)).get(key, [], []))
  assert.ok((await again.open('saved', 'year', LAYOUT_VERSION)).get(key, [], []))
  assert.equal((await again.open('ordinary-0', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  assert.equal(JSON.parse(storage.raw!).buckets.length, 6)
})

test('ブックマークを解除すると再起動前の利用順で通常の削除候補へ戻る', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  await cache.setBookmarked('p0', true, LAYOUT_VERSION)
  for (let i = 0; i < 6; i++) {
    const session = await cache.open(`p${i}`, 'month', LAYOUT_VERSION)
    session.set(key, layout)
    await session.save()
  }
  const restarted = new HistoryLayoutCache(async () => storage)
  await restarted.setBookmarked('p0', false, LAYOUT_VERSION)
  const next = await restarted.open('p6', 'month', LAYOUT_VERSION)
  next.set(key, layout)
  await next.save()
  const again = new HistoryLayoutCache(async () => storage)
  assert.equal((await again.open('p0', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  assert.ok((await again.open('p1', 'month', LAYOUT_VERSION)).get(key, [], []))
})

test('ブックマークだけで枠が埋まっても上限を守り、古いブックマークから外す', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  await cache.syncBookmarkedPlans(Array.from({ length: 7 }, (_, i) => `p${i}`), LAYOUT_VERSION)
  for (let i = 0; i < 7; i++) {
    const session = await cache.open(`p${i}`, 'month', LAYOUT_VERSION)
    session.set(key, layout)
    await session.save()
  }
  const ordinary = await cache.open('ordinary', 'month', LAYOUT_VERSION)
  ordinary.set(key, layout)
  await ordinary.save()
  const again = new HistoryLayoutCache(async () => storage)
  assert.equal((await again.open('p0', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  assert.equal((await again.open('ordinary', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  for (let i = 1; i < 7; i++) assert.ok((await again.open(`p${i}`, 'month', LAYOUT_VERSION)).get(key, [], []))
})

// 保存だけを優先していた頃は、保存したデスクで枠が埋まると自分のデスクの図が保存直後に押し出された
test('保存したデスクで枠が埋まっても、自分のデスクは同じ優先で利用順に残る', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  await cache.syncBookmarkedPlans(Array.from({ length: 6 }, (_, i) => `p${i}`), LAYOUT_VERSION)
  for (let i = 0; i < 6; i++) {
    const session = await cache.open(`p${i}`, 'month', LAYOUT_VERSION)
    session.set(key, layout)
    await session.save()
  }
  const mine = await cache.open('mine', 'month', LAYOUT_VERSION, { own: true })
  mine.set(key, layout)
  await mine.save()
  const restarted = new HistoryLayoutCache(async () => storage)
  assert.ok((await restarted.open('mine', 'month', LAYOUT_VERSION)).get(key, [], []))
  assert.equal((await restarted.open('p0', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  // 再起動後も自分のデスクの印が残り、通常のデスクより先には落ちない
  const ordinary = await restarted.open('ordinary', 'month', LAYOUT_VERSION)
  ordinary.set(key, layout)
  await ordinary.save()
  const again = new HistoryLayoutCache(async () => storage)
  assert.ok((await again.open('mine', 'month', LAYOUT_VERSION)).get(key, [], []))
  assert.equal((await again.open('ordinary', 'month', LAYOUT_VERSION)).get(key, [], []), null)
})

test('文字数上限でも新しい通常デスクを先に落とし、同期一覧から消えたブックマークの優先を外す', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  const large = { ...layout, nodes: [{ ...node, gadget: { ...gadget, name: 'x'.repeat(1_100_000) } }] }
  await cache.setBookmarked('saved', true, LAYOUT_VERSION)
  const saved = await cache.open('saved', 'month', LAYOUT_VERSION)
  saved.set(key, large)
  await saved.save()
  const ordinary = await cache.open('ordinary', 'month', LAYOUT_VERSION)
  ordinary.set(key, large)
  await ordinary.save()
  assert.ok(storage.raw!.length <= 2 * 1024 * 1024)
  const restarted = new HistoryLayoutCache(async () => storage)
  assert.ok((await restarted.open('saved', 'month', LAYOUT_VERSION)).get(key, [], []))
  assert.equal((await restarted.open('ordinary', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  await restarted.syncBookmarkedPlans([], LAYOUT_VERSION)
  const next = await restarted.open('ordinary', 'month', LAYOUT_VERSION)
  next.set(key, large)
  await next.save()
  const again = new HistoryLayoutCache(async () => storage)
  assert.equal((await again.open('saved', 'month', LAYOUT_VERSION)).get(key, [], []), null)
  assert.ok((await again.open('ordinary', 'month', LAYOUT_VERSION)).get(key, [], []))
})

test('読み込み中の解除・一覧同期・ログアウトを保存済みの優先フラグで巻き戻さない', async () => {
  const storage = memoryStorage()
  const cache = new HistoryLayoutCache(async () => storage)
  await cache.setBookmarked('saved', true, LAYOUT_VERSION)
  const session = await cache.open('saved', 'month', LAYOUT_VERSION)
  session.set(key, layout)
  await session.save()
  const raw = storage.raw
  const reading = deferred<string | null>()
  const restarting = new HistoryLayoutCache(async () => ({ ...storage, getItem: () => reading.promise }))
  const removing = restarting.setBookmarked('saved', false, LAYOUT_VERSION)
  reading.resolve(raw)
  await removing
  assert.equal(JSON.parse(storage.raw!).buckets[0].bookmarked, false)

  const syncStorage = memoryStorage(raw)
  const syncing = new HistoryLayoutCache(async () => syncStorage)
  await syncing.syncBookmarkedPlans([], LAYOUT_VERSION)
  // 読み込み前に受け取ったサーバーの全件一覧が、ディスクの古いフラグより優先される。
  const synced = await syncing.open('saved', 'month', LAYOUT_VERSION)
  await synced.save()
  await syncing.flush()
  assert.equal(JSON.parse(syncStorage.raw!).buckets[0].bookmarked, false)

  const delayed = deferred<string | null>()
  const clearing = new HistoryLayoutCache(async () => ({ ...storage, getItem: () => delayed.promise }))
  const marking = clearing.setBookmarked('saved', true, LAYOUT_VERSION)
  await clearing.clear()
  delayed.resolve(raw)
  await marking
  assert.equal(storage.raw, null)
})

test('「今日」ページは前の日の図から撤去分を除くだけで、位置も線の経路も変えない', async () => {
  for (const demo of buildAllDemoDesks('ja')) {
    for (const grain of ['day', 'month', 'year'] as const) {
      const events = appendTodayPage(buildTimeline(demo.gadgets, demo.plan, 'ja', grain), localDateKey())
      const lastChange = events.filter((e) => !e.isTodayPage).at(-1)?.date
      const layouts = (await computeHistoryLayouts(demo.plan, events, lastChange, grain, {}, new HistoryLayoutCache(async () => memoryStorage())))!
      const today = layouts.at(-1)!
      const prev = layouts.at(-2)!
      const lastEvent = events.at(-2)!
      const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]))
      const prevEdges = new Map(prev.edges.map((e) => [e.conn.id, e]))
      for (const n of today.nodes) {
        assert.ok(prevNodes.has(n.id), `${demo.plan.name} ${grain}: ${n.id} が今日だけに現れた`)
        assert.deepEqual([n.x, n.y], [prevNodes.get(n.id)!.x, prevNodes.get(n.id)!.y], `${demo.plan.name} ${grain}: ${n.id} が動いた`)
      }
      for (const e of today.edges) {
        assert.deepEqual(e.points, prevEdges.get(e.conn.id)?.points, `${demo.plan.name} ${grain}: ${e.conn.id} の経路が変わった`)
        assert.ok(today.nodes.includes(e.from) && today.nodes.includes(e.to))
      }
      const kept = new Set(lastEvent.gadgets.map((g) => g.id))
      const keptConnections = new Set(lastEvent.connections.map((c) => c.id))
      for (const g of lastEvent.renderGadgets.filter((g) => !kept.has(g.id))) {
        assert.ok(!today.nodes.some((n) => n.gadget.id === g.id), `${demo.plan.name} ${grain}: 撤去した ${g.id} が残っている`)
      }
      for (const c of lastEvent.renderConnections.filter((c) => !keptConnections.has(c.id))) {
        assert.ok(!today.edges.some((e) => e.conn.id === c.id), `${demo.plan.name} ${grain}: 撤去した線 ${c.id} が残っている`)
      }
    }
  }
})
