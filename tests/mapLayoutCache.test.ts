import assert from 'node:assert/strict'
import test from 'node:test'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { Gadget, MapConnection } from '../src/types'
import { clearMapLayoutCache, getOrComputeMapLayout, makeLayoutInputKey, parsePersistedLayoutCache, tryGetCachedLayout } from '../src/utils/mapLayoutCache'
import { MapLayout, MapLayoutCancelled } from '../src/utils/connectionMapLayout'

const gadget: Gadget = {
  id: 'g1',
  name: 'Monitor',
  category: 'Monitor',
  ports: [],
  createdAt: '2026-08-24',
}

const layout: MapLayout = {
  nodes: [{
    id: gadget.id,
    gadget,
    tier: 0,
    x: 10,
    y: 10,
    w: 100,
    h: 60,
    cx: 60,
    cy: 40,
    isWall: false,
  }],
  edges: [],
  width: 120,
  height: 80,
  bounds: { minX: 10, minY: 10, maxX: 110, maxY: 70 },
}

const connection = (overrides: Partial<MapConnection> = {}): MapConnection => ({
  id: 'c1',
  fromGadgetId: 'g1',
  toGadgetId: 'g2',
  cableType: 'USB_C',
  origin: 'auto',
  confirmed: true,
  ...overrides,
})

test('永続レイアウトを検証して復元できる', () => {
  const key = makeLayoutInputKey([gadget], [], [], {}, {})
  const entries = parsePersistedLayoutCache(JSON.stringify({
    version: 1,
    entries: [{ planId: 'p1', key, layout, usedAt: 1 }],
  }))
  assert.equal(entries.length, 1)
  assert.deepEqual(entries[0]?.layout, layout)
})

test('旧アルゴリズム、壊れたJSON、不正な数値を破棄する', () => {
  assert.deepEqual(parsePersistedLayoutCache('{broken'), [])
  assert.deepEqual(parsePersistedLayoutCache(JSON.stringify({
    version: 1,
    entries: [{ planId: 'p1', key: '23||old', layout, usedAt: 1 }],
  })), [])
  assert.deepEqual(parsePersistedLayoutCache(JSON.stringify({
    version: 1,
    entries: [{ planId: 'p1', key: makeLayoutInputKey([gadget], [], [], {}, {}), layout: { ...layout, width: null }, usedAt: 1 }],
  })), [])
})

test('配線の給電口と作成種別が変わるとキャッシュを無効化する', () => {
  const base = makeLayoutInputKey([gadget], [connection()], [], {}, {})
  const sourceChanged = makeLayoutInputKey([gadget], [connection({ sourcePortId: 'usb-c#2' })], [], {}, {})
  const originChanged = makeLayoutInputKey([gadget], [connection({ origin: 'manual' })], [], {}, {})
  assert.notEqual(base, sourceChanged)
  assert.notEqual(base, originChanged)
})

test('配置・サイズ・中央寄せが変わるとキャッシュを無効化する', () => {
  const base = makeLayoutInputKey([gadget], [], [], {}, {})
  assert.notEqual(base, makeLayoutInputKey([gadget], [], [{ gadgetId: 'g1', zone: 'desk_left' }], {}, {}))
  assert.notEqual(
    makeLayoutInputKey([gadget], [], [{ gadgetId: 'g1', zone: 'room_center' }], {}, {}),
    makeLayoutInputKey([gadget], [], [{ gadgetId: 'g1', zone: 'room_center', label: '窓側' }], {}, {}),
  )
  assert.notEqual(base, makeLayoutInputKey([gadget], [], [], { g1: { dx: 1, dy: 0 } }, {}))
  assert.notEqual(base, makeLayoutInputKey([gadget], [], [], {}, { g1: { w: 120, h: 80 } }))
  assert.notEqual(base, makeLayoutInputKey([gadget], [], [], {}, {}, true))
})

test('数量と固定先が変わると内包ノード用キャッシュを無効化する', () => {
  const base = makeLayoutInputKey([gadget], [], [], {}, {})
  assert.notEqual(base, makeLayoutInputKey([{ ...gadget, quantity: 2 }], [], [], {}, {}))
  assert.notEqual(base, makeLayoutInputKey([{ ...gadget, mounting: { targetGadgetId: 'tripod', type: 'mounted_on' } }], [], [], {}, {}))
})

test('呼び名を変えるとキーが変わり、付けていないガジェットのキーは従来のまま', () => {
  const plain = makeLayoutInputKey([gadget], [], [], {}, {})
  assert.equal(makeLayoutInputKey([{ ...gadget, nickname: undefined }], [], [], {}, {}), plain)
  const named = makeLayoutInputKey([{ ...gadget, nickname: 'サブモニター' }], [], [], {}, {})
  assert.notEqual(named, plain)
  assert.notEqual(makeLayoutInputKey([{ ...gadget, nickname: '左モニター' }], [], [], {}, {}), named)
})

const demo = buildAllDemoDesks('ja')[0]
const sharedInput = [
  demo.activeGadgets.filter((g) => g.category !== 'Cable'),
  demo.plan.connectionMap?.connections ?? [],
  demo.plan.placements,
  {}, {}, !!demo.plan.templateId,
] as const

test('画面が離脱しても同じ計算を使う先読みと別画面は完了できる', async (t) => {
  t.mock.method(AsyncStorage, 'getItem', async () => null)
  t.mock.method(AsyncStorage, 'setItem', async () => {})
  t.mock.method(AsyncStorage, 'removeItem', async () => {})
  await clearMapLayoutCache()
  const controller = new AbortController()
  const leaving = getOrComputeMapLayout('shared-test', ...sharedInput, controller.signal)
  const warmup = getOrComputeMapLayout('shared-test', ...sharedInput)
  const otherScreen = getOrComputeMapLayout('shared-test', ...sharedInput, new AbortController().signal)
  const rejection = assert.rejects(leaving, MapLayoutCancelled)
  const timer = setTimeout(() => controller.abort(), 0)
  try {
    await rejection
    const [a, b] = await Promise.all([warmup, otherScreen])
    assert.equal(a, b)
    assert.equal(tryGetCachedLayout('shared-test', ...sharedInput), a)
  } finally {
    clearTimeout(timer)
    await clearMapLayoutCache()
  }
})

test('最後の利用者が離脱すると中断し、同じ入力の再表示は新しい計算で完了する', async (t) => {
  t.mock.method(AsyncStorage, 'getItem', async () => null)
  t.mock.method(AsyncStorage, 'setItem', async () => {})
  t.mock.method(AsyncStorage, 'removeItem', async () => {})
  await clearMapLayoutCache()
  const controller = new AbortController()
  const first = getOrComputeMapLayout('restart-test', ...sharedInput, controller.signal)
  const second = getOrComputeMapLayout('restart-test', ...sharedInput, controller.signal)
  const rejections = Promise.all([assert.rejects(first, MapLayoutCancelled), assert.rejects(second, MapLayoutCancelled)])
  const timer = setTimeout(() => controller.abort(), 0)
  try {
    await rejections
    assert.equal(tryGetCachedLayout('restart-test', ...sharedInput), null)
    const replacement = await getOrComputeMapLayout('restart-test', ...sharedInput)
    assert.equal(tryGetCachedLayout('restart-test', ...sharedInput), replacement)
  } finally {
    clearTimeout(timer)
    await clearMapLayoutCache()
  }
})

test('すでに離脱した画面は計算を開始しない', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(getOrComputeMapLayout('aborted-test', ...sharedInput, controller.signal), MapLayoutCancelled)
  assert.equal(tryGetCachedLayout('aborted-test', ...sharedInput), null)
})
