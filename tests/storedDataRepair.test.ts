import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  repairStoredConversations,
  repairStoredFolders,
  repairStoredGadgets,
  repairStoredPlans,
} from '../src/utils/storedDataRepair'

describe('stored data repair', () => {
  it('drops unusable gadgets and fills missing ports so one broken item cannot take down every screen', () => {
    const ok = { id: 'a', name: 'PC', category: 'PC', ports: [], createdAt: '' }
    const repaired = repairStoredGadgets([
      ok,
      null,
      'text',
      { name: 'no id' },
      { id: 'b', name: 'Monitor', category: 'Monitor', ports: null },
      { id: 'a', name: 'duplicate', category: 'PC', ports: [] },
    ])
    assert.deepEqual(repaired.map((g) => g.id), ['a', 'b'])
    // 形が正しい1件は作り直さない（同じ参照のまま返す）
    assert.equal(repaired[0], ok)
    assert.deepEqual(repaired[1].ports, [])
  })

  it('fills the arrays every desk screen reads directly', () => {
    const [plan] = repairStoredPlans([
      { id: 'd', name: 'desk', selectedGadgetIds: ['a', 3, null], placements: 'broken', purposes: 'gaming' },
    ])
    assert.deepEqual(plan.selectedGadgetIds, ['a'])
    assert.deepEqual(plan.placements, [])
    assert.deepEqual(plan.purposes, [])
    assert.equal(plan.images, undefined)
  })

  it('fills the timestamps that the gadget and desk lists sort with', () => {
    const gadgets = repairStoredGadgets([
      { id: 'a', name: 'PC', category: 'PC', ports: [], createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'b', name: 'Monitor', category: 'Monitor', ports: [] },
    ])
    assert.equal(gadgets[1].createdAt, '')
    // useGadgets の並べ替えが例外にならない（落ちると全ガジェットが読み込み失敗扱いになる）
    assert.doesNotThrow(() => [...gadgets].sort((x, y) => y.createdAt.localeCompare(x.createdAt)))

    const plans = repairStoredPlans([
      { id: 'd1', name: 'desk', selectedGadgetIds: [], placements: [], createdAt: '2026-09-01' },
      { id: 'd2', name: 'desk', selectedGadgetIds: [], placements: [] },
    ])
    // 最後に触った時刻が無ければ作った時刻で並べる
    assert.equal(plans[0].updatedAt, '2026-09-01')
    assert.equal(plans[1].createdAt, '')
    assert.equal(plans[1].updatedAt, '')
    assert.doesNotThrow(() => [...plans].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)))
  })

  it('drops broken wiring entries and usage periods so the desk can still be opened', () => {
    const clean = {
      id: 'ok', name: 'desk', selectedGadgetIds: [], placements: [], createdAt: '', updatedAt: '',
      connectionMap: { connections: [{ id: 'c', fromGadgetId: 'a', toGadgetId: 'b' }] },
      gadgetUsage: { a: { periods: [{ mode: 'active', startedAt: '2026-09-01' }] } },
    }
    const [unchanged, repaired] = repairStoredPlans([
      clean,
      {
        id: 'broken', name: 'desk', selectedGadgetIds: [], placements: [], createdAt: '', updatedAt: '',
        connectionMap: { connections: [null, { id: 'c', fromGadgetId: 'a', toGadgetId: 'b' }] },
        wiringResult: { connections: 'x', warnings: ['w', 1] },
        gadgetUsage: { a: { periods: [null, { mode: 'active', startedAt: '2026-09-01' }] }, b: { periods: {} } },
      },
    ])
    // 形の正しいデスクは作り直さない
    assert.equal(unchanged, clean)
    assert.equal(repaired.connectionMap?.connections.length, 1)
    assert.deepEqual(repaired.wiringResult?.connections, [])
    assert.deepEqual(repaired.wiringResult?.warnings, ['w'])
    assert.equal(repaired.gadgetUsage?.a.periods?.length, 1)
    assert.deepEqual(repaired.gadgetUsage?.b.periods, [])
  })

  it('keeps a conversation list sortable and readable after a bad entry', () => {
    const repaired = repairStoredConversations<{ id: string; updatedAt: string; messages: unknown[] }>([
      { id: 'c1', title: 't', updatedAt: '2026-09-01', createdAt: '', messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 42 }] },
      { id: 'c2' },
      null,
    ])
    assert.deepEqual(repaired.map((c) => c.id), ['c1', 'c2'])
    assert.equal(repaired[1].updatedAt, '')
    assert.equal(repaired[0].messages.length, 1)
    // 並べ替えが例外にならない
    assert.doesNotThrow(() => [...repaired].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  })

  it('drops folders without an id', () => {
    assert.deepEqual(repairStoredFolders([{ id: 'f', name: 'Desk', color: '#000', sortOrder: 0, createdAt: '' }, { name: 'x' }]).map((f) => f.id), ['f'])
  })
})
