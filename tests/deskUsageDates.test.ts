import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { applyDeskGadgetUsage, applyLibraryUsage, hasCurrentDeskUsageAfterEdit, updateDeskGadgetSelection } from '../src/utils/deskGadgetUsage'
import { calendarDateOf, usagePeriodsOf } from '../src/utils/deskTimeline'
import { DeskPlan, Gadget } from '../src/types'

// UTC と現地の暦日がずれる時間帯を再現する。UTC の端末で走らせると
// どちらの実装でも通ってしまい、この種のバグを素通りさせるため固定する。
process.env.TZ = 'Asia/Tokyo'

// 2026-09-01 23:30 UTC = 2026-09-02 08:30 JST（UTC 日付は前日）
const MORNING_IN_JST = Date.UTC(2026, 8, 1, 23, 30)

function gadget(id: string, createdAt: string, purchasedAt?: string): Gadget {
  return { id, name: id, category: 'Plant', ports: [], purchasedAt, createdAt }
}

function plan(selectedGadgetIds: string[]): DeskPlan {
  return {
    id: 'usage-dates',
    name: 'usage-dates',
    goal: 'improve_desk',
    selectedGadgetIds,
    placements: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('利用状況の日付は端末の暦日で記録する', () => {
  it('未入力の日付と候補の登録日は導入日・履歴に代用しない', () => {
    for (const flags of [{ introducedAtUnknown: true }, { isCandidate: true }]) {
      const item = { ...gadget('unknown', '2026-09-01T23:30:00.000Z'), ...flags }
      const desk = plan([item.id])
      assert.deepEqual(usagePeriodsOf(item), [])
      assert.equal(applyDeskGadgetUsage(desk, item).purchasedAt, undefined)
      assert.equal(applyLibraryUsage(item, [desk]).purchasedAt, undefined)
      const selected = updateDeskGadgetSelection(plan([]), [item.id], [item])
      assert.equal(selected.gadgetUsage?.[item.id], undefined)
      assert.deepEqual(selected.selectedGadgetIds, [item.id])
      assert.equal(applyDeskGadgetUsage(selected, item).purchasedAt, undefined)
      assert.equal(hasCurrentDeskUsageAfterEdit(selected, item, []), true)
      const removed = updateDeskGadgetSelection(selected, [], [item])
      const restored = updateDeskGadgetSelection(removed, [item.id], [item])
      assert.equal(applyDeskGadgetUsage(restored, item).purchasedAt, undefined)
      assert.equal(usagePeriodsOf({ ...item, purchasedAt: '2025-04-01' })[0]?.startedAt, '2025-04-01')
    }
  })
  it('入力済みの在籍期間を削除・終了した場合はデスクから外す', () => {
    const item = gadget('known', '2026-01-01T00:00:00.000Z', '2026-01-01')
    const desk = plan([item.id])
    assert.equal(hasCurrentDeskUsageAfterEdit(desk, item, []), false)
    assert.equal(hasCurrentDeskUsageAfterEdit(desk, item, [{ mode: 'active', startedAt: '2026-01-01', endedAt: '2026-02-01' }]), false)
    assert.equal(hasCurrentDeskUsageAfterEdit(desk, item, [{ mode: 'active', startedAt: '2026-01-01' }]), true)
  })
  it('デスクへの追加日が UTC ではなく現地の日付になる', () => {
    mock.timers.enable({ apis: ['Date'], now: MORNING_IN_JST })
    try {
      const item = gadget('added', '2026-08-01T00:00:00.000Z', '2026-08-01')
      // 一度外した状態から入れ直すと、操作日で新しい期間が始まる
      const before = {
        ...plan([]),
        gadgetUsage: { added: { periods: [{ mode: 'active' as const, startedAt: '2026-08-01', endedAt: '2026-08-20' }] } },
      }
      const updated = updateDeskGadgetSelection(before, ['added'], [item])
      assert.deepEqual(updated.gadgetUsage?.added.periods, [
        { mode: 'active', startedAt: '2026-08-01', endedAt: '2026-08-20' },
        { mode: 'active', startedAt: '2026-09-02', startedAtSource: 'auto' },
      ])
    } finally {
      mock.timers.reset()
    }
  })

  it('デスクから外した日が UTC ではなく現地の日付になる', () => {
    mock.timers.enable({ apis: ['Date'], now: MORNING_IN_JST })
    try {
      const item = gadget('removed', '2026-08-01T00:00:00.000Z', '2026-08-01')
      const updated = updateDeskGadgetSelection(plan(['removed']), [], [item])
      assert.equal(updated.gadgetUsage?.removed.periods?.at(-1)?.endedAt, '2026-09-02')
    } finally {
      mock.timers.reset()
    }
  })

  // ガジェット一覧の「撤去」と、その5秒Undo が乗っている挙動。
  // ここが割れると、戻したはずの年表に1日で終わる期間が残る
  it('同じ日に撤去して戻すと、在籍期間が2本に割れずに再開する', () => {
    mock.timers.enable({ apis: ['Date'], now: MORNING_IN_JST })
    try {
      const item = gadget('retired', '2026-08-01T00:00:00.000Z', '2026-08-01')
      const retired = updateDeskGadgetSelection(plan(['retired']), [], [item])
      assert.equal(retired.gadgetUsage?.retired.periods?.at(-1)?.endedAt, '2026-09-02')

      const restored = updateDeskGadgetSelection(retired, ['retired'], [item])
      const periods = restored.gadgetUsage?.retired.periods ?? []
      assert.equal(periods.length, 1)
      assert.equal(periods[0].startedAt, '2026-08-01')
      assert.equal(periods[0].endedAt, undefined)
      assert.deepEqual(restored.selectedGadgetIds, ['retired'])
    } finally {
      mock.timers.reset()
    }
  })

  it('購入日が無いとき、登録日時(UTC)を現地の暦日へ直して在席開始日にする', () => {
    const item = gadget('created', '2026-09-01T23:30:00.000Z')
    assert.deepEqual(usagePeriodsOf(item), [
      { mode: 'active', startedAt: '2026-09-02', endedAt: undefined, startedAtSource: 'registered' },
    ])
  })

  it('すでに YYYY-MM-DD の日付はタイムゾーンで動かさない', () => {
    assert.equal(calendarDateOf('2026-09-02'), '2026-09-02')
    assert.equal(calendarDateOf('2026-02-30'), null)
    assert.equal(calendarDateOf(undefined), null)
  })
})
