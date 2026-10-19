import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FULL_SWIPE_HYSTERESIS,
  fullSwipeThreshold,
  nextFullSwipeArmed,
  restoreAt,
} from '../src/utils/fullSwipe'

describe('全スワイプの閾値', () => {
  it('幅いっぱいの行では行幅の割合で決まる', () => {
    assert.equal(fullSwipeThreshold(390, 84), 390 * 0.55)
  })

  it('2列のタイルのように狭い行では、ボタン幅に一定の距離を足した値を下回らない', () => {
    // 割合だけだと 93.5 でボタン幅 88 とほぼ同じになり、ボタンを出すつもりで確定してしまう
    assert.equal(fullSwipeThreshold(170, 88), 88 + 56)
  })
})

describe('離したら確定する状態', () => {
  const threshold = 200

  it('閾値に届いたら確定する状態になる', () => {
    assert.equal(nextFullSwipeArmed(199, threshold, false), false)
    assert.equal(nextFullSwipeArmed(200, threshold, false), true)
  })

  it('越えたあとは遊びの分だけ戻すまで解除しない', () => {
    assert.equal(nextFullSwipeArmed(threshold - FULL_SWIPE_HYSTERESIS + 1, threshold, true), true)
    assert.equal(nextFullSwipeArmed(threshold - FULL_SWIPE_HYSTERESIS, threshold, true), false)
  })

  it('解除したあとは、もう一度閾値まで引かないと確定しない', () => {
    assert.equal(nextFullSwipeArmed(threshold - 5, threshold, false), false)
  })
})

describe('元に戻すで元の位置へ戻す', () => {
  const same = (a: { id: string }, b: { id: string }) => a.id === b.id

  it('外した位置へ戻す', () => {
    const list = [{ id: 'a' }, { id: 'c' }]
    assert.deepEqual(restoreAt(list, { id: 'b' }, 1, same).map((x) => x.id), ['a', 'b', 'c'])
  })

  it('一覧が縮んでいたら末尾に置く', () => {
    assert.deepEqual(restoreAt([{ id: 'a' }], { id: 'z' }, 5, same).map((x) => x.id), ['a', 'z'])
  })

  it('読み直しで既に戻っていれば二重にしない', () => {
    const list = [{ id: 'a' }, { id: 'b' }]
    assert.deepEqual(restoreAt(list, { id: 'b' }, 0, same).map((x) => x.id), ['a', 'b'])
  })
})
