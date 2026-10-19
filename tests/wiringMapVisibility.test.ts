import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DeskPlan, Gadget, GadgetCategory, MapConnection } from '../src/types'
import { computeMapLayout, computeMapNodeSizes } from '../src/utils/connectionMapLayout'
import { buildTimeline } from '../src/utils/deskTimeline'
import { HistoryLayoutCache } from '../src/utils/historyLayoutCache'
import { computeHistoryLayouts } from '../src/utils/historyLayouts'
import { buildHistoryReplacementLayoutPlan, restoreHistoryReplacementLayout } from '../src/utils/historyReplacement'

const gadget = (id: string, category: GadgetCategory, extra: Partial<Gadget> = {}): Gadget => ({
  id, name: id, category, ports: [], purchasedAt: '2024-01-01', createdAt: '2024-01-01T00:00:00.000Z', ...extra,
})
const powerPort: Gadget['ports'] = [{ id: 'power', type: 'Power', direction: 'input', count: 1 }]

test('配線のない家具・小物と飾りを除き、未接続の機器と電源付き家具を残す', async () => {
  const hidden = [gadget('desk', 'Desk'), gadget('chair', 'Chair'), gadget('plant', 'Plant'),
    gadget('pad', 'DeskPad'), gadget('figure', 'Other'), gadget('decor-pc', 'PC', { displayOnly: true, ports: powerPort })]
  const visible = [gadget('pc', 'PC'), gadget('mouse', 'Mouse'), gadget('electric-desk', 'Desk', { ports: powerPort })]
  const gadgets = [...hidden, ...visible]
  const layout = await computeMapLayout(gadgets, [])
  assert.deepEqual(layout.nodes.map((node) => node.id).sort(), visible.map((item) => item.id).sort())
  assert.deepEqual([...computeMapNodeSizes(gadgets, []).keys()].sort(), visible.map((item) => item.id).sort())
})

test('ポート情報のない家具も保存済みの接続を持つ場合は線と一緒に残す', async () => {
  const connection: MapConnection = {
    id: 'desk-power', fromGadgetId: 'wall', toGadgetId: 'desk', cableType: 'Power', origin: 'manual', confirmed: true,
  }
  const layout = await computeMapLayout([gadget('desk', 'Desk')], [connection])
  assert.ok(layout.nodes.some((node) => node.id === 'desk'))
  assert.equal(layout.edges[0].conn.id, connection.id)
})

test('家具と飾りだけなら擬似的な飾り枠もない空の図を返す', async () => {
  const layout = await computeMapLayout([gadget('desk', 'Desk'), gadget('decor', 'PC', { displayOnly: true })], [])
  assert.equal(layout.nodes.length, 0)
  assert.equal(layout.edges.length, 0)
  assert.ok(Object.values(layout.bounds).every(Number.isFinite))
})

test('歴史でも家具を除き、機器は実働の期間だけ表示する', async () => {
  const pc = gadget('pc', 'PC', { deskUsagePeriods: [
    { mode: 'active', startedAt: '2024-01-01', endedAt: '2024-02-01' },
    { mode: 'decor', startedAt: '2024-02-01', endedAt: '2024-03-01' },
    { mode: 'active', startedAt: '2024-03-01' },
  ] })
  const gadgets = [pc, gadget('desk', 'Desk'), gadget('plant', 'Plant')]
  const plan: DeskPlan = {
    id: 'visibility-history', name: 'test', goal: 'clean_wiring', selectedGadgetIds: gadgets.map((item) => item.id),
    placements: [], createdAt: pc.createdAt, updatedAt: pc.createdAt,
  }
  const events = buildTimeline(gadgets, plan, 'ja', 'day', '2024-03-02')
  const cache = new HistoryLayoutCache(async () => ({
    async getItem() { return null }, async setItem() {}, async removeItem() {},
  }))
  const layouts = await computeHistoryLayouts(plan, events, events.at(-1)?.date, 'day', {}, cache)
  assert.ok(layouts)
  assert.deepEqual(layouts.map((layout) => layout.nodes.map((node) => node.id)), [['pc'], [], ['pc']])
  assert.ok(events[0].inGadgets.some((item) => item.id === 'desk'))
})

test('電源付きデスクへの買い替えで配線のない旧デスクを図へ戻さない', async () => {
  const oldDesk = gadget('old-desk', 'Desk')
  const newDesk = gadget('new-desk', 'Desk', { ports: powerPort })
  const replacement = buildHistoryReplacementLayoutPlan([newDesk], [oldDesk], [], [oldDesk, newDesk], [])
  const raw = await computeMapLayout(replacement.gadgets, replacement.connections)
  const layout = restoreHistoryReplacementLayout(raw, replacement)
  assert.deepEqual(layout.nodes.map((node) => node.id), ['new-desk'])
})
