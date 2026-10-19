import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskWithDetails } from '../src/supabase/types'
import { toPublicDeskModel } from '../src/utils/publicDeskAdapter'

// share_snapshot は投稿者の端末（や API を直接叩いた人）が書いた JSON。
// 壊れた1件で、そのデスクを開いた全員の公開デスク画面が落ちないことを確かめる
function deskWith(snapshot: unknown): DeskWithDetails {
  return {
    id: 'desk-1',
    user_id: 'u1',
    title: 'desk',
    description: null,
    visibility: 'public',
    purposes: [],
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
    share_snapshot: snapshot,
    desk_photos: [],
    devices: [],
    connections: [],
  } as unknown as DeskWithDetails
}

describe('public desk snapshot repair', () => {
  it('removes non-string dismissed pairs before normalizing a public snapshot', () => {
    for (const dismissedPairs of [[null, 42, {}, 'g1|g2|Thunderbolt3'], 'broken', null]) {
      const model = toPublicDeskModel(deskWith({
        plan: { selectedGadgetIds: [], connectionMap: { connections: [], dismissedPairs } },
        gadgets: [],
      }))
      assert.deepEqual(model.plan.connectionMap?.dismissedPairs,
        Array.isArray(dismissedPairs) ? ['g1|g2|Thunderbolt'] : [])
    }
  })

  it('opens a desk whose snapshot has broken gadgets, connections and usage periods', () => {
    const desk = deskWith({
      version: 2,
      plan: {
        id: 'p',
        name: 'desk',
        selectedGadgetIds: ['g1', 'g2', 42],
        placements: [null, 'x'],
        connectionMap: { connections: [null, { id: 'c1', fromGadgetId: 'g1', toGadgetId: 'g2', cableType: 'USB_C' }] },
        wiringResult: { connections: [null], requiredCables: ['x'], warnings: ['ok', 3] },
        gadgetUsage: {
          g1: { periods: [null, { mode: 'active', startedAt: 20260901 }, { mode: 'active', startedAt: '2026-09-01' }] },
          g2: { periods: 'broken' },
          g3: 'broken',
        },
      },
      gadgets: [
        { id: 'g1', name: null, category: 'PC', ports: [] },
        { id: 'g2', name: 'Monitor', category: 'Monitor', ports: 'broken' },
        { name: 'no id' },
        null,
        { id: 'g1', name: 'duplicate', category: 'PC', ports: [] },
      ],
    })

    const model = toPublicDeskModel(desk)
    assert.deepEqual(model.selectedGadgets.map((g) => g.id), ['g1', 'g2'])
    // 名前が文字列でない1台も描ける（表示側が startsWith で読む）
    assert.equal(model.selectedGadgets[0].name, '')
    assert.deepEqual(model.selectedGadgets[1].ports, [])
    assert.equal(model.plan.wiringResult?.connections.length, 0)
    assert.deepEqual(model.plan.wiringResult?.warnings, ['ok'])
    // 開始日の無い期間・配列でない periods は落とす
    assert.deepEqual(model.plan.gadgetUsage?.g1.periods?.map((p) => p.startedAt), ['2026-09-01'])
    assert.deepEqual(model.plan.gadgetUsage?.g2.periods, [])
    assert.equal(model.plan.gadgetUsage?.g3, undefined)
  })
})
