import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clapStateOf, clapStates } from '../src/utils/clapRound'

const ROUND_1 = '2026-09-01T10:00:00.123456+00:00'
const ROUND_2 = '2026-09-20T08:30:00.654321+00:00'

describe('拍手は版ごと（095）', () => {
  it('今の版への拍手だけを拍手済みにし、前の版だけのデスクは押せる状態に戻す', () => {
    const { current, before } = clapStates([
      { desk_id: 'a', round_at: ROUND_2, desk: { clap_round_at: ROUND_2 } },
      { desk_id: 'b', round_at: ROUND_1, desk: { clap_round_at: ROUND_2 } },
    ])
    assert.deepEqual([...current], ['a'])
    assert.deepEqual([...before], ['b'])
  })

  it('前の版と今の版の両方に拍手していれば、拍手済みかつ前にも拍手した扱い', () => {
    const rows = [
      { desk_id: 'a', round_at: ROUND_1, desk: { clap_round_at: ROUND_2 } },
      { desk_id: 'a', round_at: ROUND_2, desk: { clap_round_at: ROUND_2 } },
    ]
    assert.deepEqual(clapStateOf(rows, 'a'), { clapped: true, clappedBefore: true })
  })

  it('版を読めないデスク（非公開になった等）の行は数えない', () => {
    assert.deepEqual(clapStateOf([{ desk_id: 'a', round_at: ROUND_1, desk: null }], 'a'), { clapped: false, clappedBefore: false })
    assert.deepEqual(clapStateOf(null, 'a'), { clapped: false, clappedBefore: false })
  })

  it('版はマイクロ秒まで比べる（ミリ秒に丸めると別の版を同じと見る）', () => {
    const rows = [{ desk_id: 'a', round_at: '2026-09-20T08:30:00.654000+00:00', desk: { clap_round_at: ROUND_2 } }]
    assert.deepEqual(clapStateOf(rows, 'a'), { clapped: false, clappedBefore: true })
  })
})
