import assert from 'node:assert/strict'
import { test } from 'node:test'
import { niceTicks } from '../src/utils/chartTicks'

test('ordinary chart axes retain their rounding and headroom', () => {
  assert.deepEqual(niceTicks(15), { ticks: [0, 5, 10, 15, 20], top: 20 })
  assert.deepEqual(niceTicks(100), { ticks: [0, 25, 50, 75, 100, 125], top: 125 })
  assert.deepEqual(niceTicks(9), { ticks: [0, 2.5, 5, 7.5, 10], top: 10 })
})

test('extreme public prices and tick counts always yield a finite bounded axis', () => {
  for (const max of [Number.MIN_VALUE, 1e-320, 1e-308, 0.01, 1e308, Number.MAX_VALUE, Infinity, NaN, 0, -1]) {
    for (const count of [4, 0, -1, Number.MIN_VALUE, 1e308, Infinity, NaN]) {
      const axis = niceTicks(max, count)
      assert.ok(Number.isFinite(axis.top) && axis.top > 0)
      assert.ok(axis.ticks.length >= 1 && axis.ticks.length <= 22)
      assert.ok(axis.ticks.every((tick) => Number.isFinite(tick) && tick >= 0))
    }
  }
})
