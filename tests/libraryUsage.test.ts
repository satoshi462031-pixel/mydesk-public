import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyLibraryUsage, mergeUsagePeriods } from '../src/utils/deskGadgetUsage'
import { DeskPlan, Gadget } from '../src/types'

// 導入日はガジェット本体ではなく plan.gadgetUsage が持つ。デスクを跨いだ統計は
// プランを1つに決められないので、全デスクを畳んでから読む必要がある。
process.env.TZ = 'Asia/Tokyo'

function gadget(id: string, purchasedAt?: string): Gadget {
  return { id, name: id, category: 'Plant', ports: [], purchasedAt, createdAt: '2024-01-05T00:00:00.000Z' }
}

function plan(id: string, selectedGadgetIds: string[], gadgetUsage?: DeskPlan['gadgetUsage']): DeskPlan {
  return {
    id,
    name: id,
    goal: 'improve_desk',
    selectedGadgetIds,
    placements: [],
    gadgetUsage,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('mergeUsagePeriods', () => {
  it('重なる期間を1本にまとめ、終了日は後ろへ伸ばす', () => {
    assert.deepEqual(
      mergeUsagePeriods([
        { mode: 'active', startedAt: '2024-01-01', endedAt: '2024-06-01' },
        { mode: 'active', startedAt: '2024-03-01', endedAt: '2024-09-01' },
      ]),
      [{ mode: 'active', startedAt: '2024-01-01', endedAt: '2024-09-01' }],
    )
  })

  it('デスクを移しただけの隣接期間は繋げる', () => {
    assert.deepEqual(
      mergeUsagePeriods([
        { mode: 'active', startedAt: '2024-01-01', endedAt: '2024-06-01' },
        { mode: 'active', startedAt: '2024-06-01' },
      ]),
      [{ mode: 'active', startedAt: '2024-01-01', endedAt: undefined }],
    )
  })

  it('離れている期間は分けたまま残す', () => {
    const merged = mergeUsagePeriods([
      { mode: 'active', startedAt: '2024-01-01', endedAt: '2024-03-01' },
      { mode: 'active', startedAt: '2025-01-01' },
    ])
    assert.equal(merged.length, 2)
    assert.equal(merged[1].endedAt, undefined)
  })

  it('実働と飾りが重なる期間は実働として残す', () => {
    const merged = mergeUsagePeriods([
      { mode: 'decor', startedAt: '2024-01-01', endedAt: '2024-06-01' },
      { mode: 'active', startedAt: '2024-02-01', endedAt: '2024-04-01' },
    ])
    assert.equal(merged[0].mode, 'active')
  })
})

describe('applyLibraryUsage', () => {
  it('複数デスクの在籍期間を畳んで導入日を復元する', () => {
    const item = gadget('monitor')
    const plans = [
      plan('deskA', [], { monitor: { periods: [{ mode: 'active', startedAt: '2022-04-01', endedAt: '2023-04-01' }] } }),
      plan('deskB', ['monitor'], { monitor: { periods: [{ mode: 'active', startedAt: '2023-04-01' }] } }),
    ]
    const applied = applyLibraryUsage(item, plans)
    assert.equal(applied.purchasedAt, '2022-04-01')
    assert.equal(applied.removedAt, undefined)
    assert.deepEqual(applied.deskUsagePeriods, [{ mode: 'active', startedAt: '2022-04-01', endedAt: undefined }])
  })

  it('どのデスクにも無いガジェットには登録日を代入しない', () => {
    const item = gadget('spare')
    const applied = applyLibraryUsage(item, [plan('deskA', ['other'])])
    assert.equal(applied.purchasedAt, undefined)
    assert.equal(applied.deskUsagePeriods, undefined)
  })

  it('全デスクから退役していれば撤去日が残る', () => {
    const item = gadget('oldKeyboard')
    const plans = [
      plan('deskA', [], { oldKeyboard: { periods: [{ mode: 'active', startedAt: '2021-01-01', endedAt: '2022-01-01' }] } }),
    ]
    assert.equal(applyLibraryUsage(item, plans).removedAt, '2022-01-01')
  })
})
