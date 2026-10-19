import assert from 'node:assert/strict'
import test from 'node:test'
import type { DeskPlan } from '../src/types'
import { favoriteGadgetIdSet, publishedFavoriteGadgetIds, toggleFavoriteGadget } from '../src/utils/favoriteGadgets'

const plan = (extra: Partial<DeskPlan> = {}): DeskPlan => ({
  id: 'd', name: 'desk', selectedGadgetIds: ['a', 'b'], placements: [], createdAt: '', updatedAt: '', ...extra,
} as DeskPlan)

test('お気に入りを付けて外せる。最後の1台を外したら項目ごと消す', () => {
  const on = toggleFavoriteGadget(plan(), 'a')
  assert.deepEqual(on.favoriteGadgetIds, ['a'])
  assert.equal(toggleFavoriteGadget(on, 'a').favoriteGadgetIds, undefined)
})

// 公開デスクの値は投稿者の端末が書いた JSON。配列でない値で画面ごと落とさない
test('壊れた値は空として読む', () => {
  assert.equal(favoriteGadgetIdSet(plan({ favoriteGadgetIds: { a: true } as never })).size, 0)
  assert.deepEqual([...favoriteGadgetIdSet(plan({ favoriteGadgetIds: ['a', 3, null] as never }))], ['a'])
  assert.deepEqual(toggleFavoriteGadget(plan({ favoriteGadgetIds: 'a' as never }), 'b').favoriteGadgetIds, ['b'])
})

test('公開するのは今デスクにある機材の印だけ（外した機材の印は端末に残す）', () => {
  const p = plan({ favoriteGadgetIds: ['c', 'b', 'a', 'b'] })
  assert.deepEqual(publishedFavoriteGadgetIds(p), ['a', 'b'])
  assert.deepEqual(p.favoriteGadgetIds, ['c', 'b', 'a', 'b'])
})

test('デスクのおすすめはデスクごとに独立し、ピン留めと持ち物の星に影響しない', () => {
  const gadget = { id: 'a', favorite: true }
  const first = plan({ favorite: true })
  const second = plan({ id: 'second' })
  const recommended = toggleFavoriteGadget(first, gadget.id)
  assert.deepEqual(publishedFavoriteGadgetIds(recommended), ['a'])
  assert.deepEqual(publishedFavoriteGadgetIds(second), [])
  assert.equal(recommended.favorite, true)
  assert.equal(gadget.favorite, true)
  assert.deepEqual(first.favoriteGadgetIds, undefined)
})
