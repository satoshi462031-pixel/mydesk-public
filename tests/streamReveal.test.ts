import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextRevealLength } from '../src/utils/streamReveal'

describe('nextRevealLength', () => {
  it('受信中は少しずつ進み、まとめて届いても一度に出し切らない', () => {
    const target = 'あ'.repeat(200)
    const next = nextRevealLength(0, target, false)
    assert.ok(next > 0 && next < 200)
  })

  it('受信中でも残りが少なければ最低2文字ずつ進む', () => {
    assert.equal(nextRevealLength(10, 'a'.repeat(11), false), 11)
    assert.equal(nextRevealLength(10, 'a'.repeat(20), false), 12)
  })

  it('受信が終わったら数回で出し切る', () => {
    const target = 'a'.repeat(400)
    let shown = 0
    let ticks = 0
    while (shown < target.length) {
      shown = nextRevealLength(shown, target, true)
      ticks++
    }
    assert.ok(ticks <= 12, `${ticks} 回かかった`)
  })

  it('絵文字のサロゲートペアの間で切らない', () => {
    const target = 'ab😀cd'
    // 'ab' + 上位サロゲートで切れる位置に来たら、下位サロゲートまで進める
    const next = nextRevealLength(1, target, false)
    assert.notEqual(next, 3)
  })

  it('回答が差し替えで短くなっても全長を超えない', () => {
    assert.equal(nextRevealLength(50, 'short', false), 5)
  })
})
