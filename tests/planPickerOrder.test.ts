import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sortPlansLikeMyDesk } from '../src/store/displaySettings'

const plan = (id: string, updatedAt: string, extra: { favorite?: boolean; wiringResult?: unknown } = {}) => ({
  id,
  name: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
  wiringResult: {},
  ...extra,
})

describe('デスクを選ぶ一覧の並び', () => {
  // マイデスクのタブと同じく、作成途中 → ピン留め → 最後に触った順
  it('マイデスクと同じ並びにする', () => {
    const plans = [
      plan('old', '2026-09-01T00:00:00.000Z'),
      plan('pinned', '2026-08-01T00:00:00.000Z', { favorite: true }),
      plan('draft', '2026-07-01T00:00:00.000Z', { wiringResult: undefined }),
      plan('new', '2026-09-10T00:00:00.000Z'),
    ]
    assert.deepEqual(sortPlansLikeMyDesk(plans, {}).map((p) => p.id), ['draft', 'pinned', 'new', 'old'])
  })

  it('一覧から開いた時刻も「最後に触った」に入れる', () => {
    const plans = [plan('a', '2026-09-10T00:00:00.000Z'), plan('b', '2026-09-01T00:00:00.000Z')]
    assert.deepEqual(sortPlansLikeMyDesk(plans, { b: '2026-09-20T00:00:00.000Z' }).map((p) => p.id), ['b', 'a'])
    assert.deepEqual(sortPlansLikeMyDesk(plans, null).map((p) => p.id), ['a', 'b'])
  })
})
