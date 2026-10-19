import assert from 'node:assert/strict'
import test from 'node:test'
import { Gadget } from '../src/types'
import { gadgetFinancialSummary, sumDeviceQuantities, sumGadgetPrices, sumGadgetQuantities } from '../src/utils/gadgetStats'

const gadget = (id: string, price?: number): Gadget => ({ id, price } as Gadget)

test('現在・累計・現在構成外の金額をガジェットID単位で集計する', () => {
  const current = [gadget('current', 30_000)]
  const removed = gadget('removed', 10_000)
  const summary = gadgetFinancialSummary(current, [...current, removed, removed])

  assert.deepEqual(summary, {
    currentTotal: 30_000,
    cumulativeTotal: 40_000,
    outsideTotal: 10_000,
    currentPricedCount: 1,
    currentCount: 1,
    historyPricedCount: 2,
    historyCount: 2,
  })
})

test('価格未入力を0円として合計しつつ入力率では未入力として数える', () => {
  const summary = gadgetFinancialSummary(
    [gadget('priced', 5_000), gadget('unpriced')],
    [gadget('priced', 5_000), gadget('unpriced')],
  )

  assert.equal(summary.currentTotal, 5_000)
  assert.equal(summary.currentPricedCount, 1)
  assert.equal(summary.currentCount, 2)
})

test('ケーブルは金額に入れ、台数には数えない', () => {
  const pc = { ...gadget('pc', 100_000), category: 'PC' } as Gadget
  const cable = { ...gadget('cable', 2_000), category: 'Cable' } as Gadget
  const summary = gadgetFinancialSummary([pc, cable], [pc, cable])

  assert.equal(summary.currentTotal, 102_000)
  assert.equal(summary.currentCount, 1)
  assert.equal(summary.currentPricedCount, 1)
  assert.equal(sumDeviceQuantities([pc, cable]), 1)
})

test('数量を台数と価格の両方へ反映し、不正な数量は1として扱う', () => {
  const pair = { ...gadget('pair', 12_000), quantity: 2 }
  const invalid = { ...gadget('invalid', 3_000), quantity: 0 }
  assert.equal(sumGadgetQuantities([pair, invalid]), 3)
  assert.equal(sumGadgetPrices([pair, invalid]), 27_000)
})
