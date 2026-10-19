import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inputMaxLength, tidyMultilineText, toSingleLine, trimAndTruncate, truncateChars } from '../src/utils/truncateText'

/** 対になっていないサロゲートが含まれていないか（＝表示が `�` にならないか） */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

describe('truncateChars', () => {
  it('短い文字列はそのまま返す', () => {
    assert.equal(truncateChars('仕事用デスク', 30), '仕事用デスク')
  })

  it('絵文字を割らない（生の slice はここで壊れる）', () => {
    // 19文字＋絵文字1つ。slice は UTF-16 で 21 単位と数えて絵文字を割るが、
    // コードポイントでは 20 なので、そのまま収まるのが正しい
    const input = 'あ'.repeat(19) + '\u{1F5A5}'
    assert.equal(hasLoneSurrogate(input.slice(0, 20)), true)   // 生の slice が壊すことの確認
    const cut = truncateChars(input, 20)
    assert.equal(hasLoneSurrogate(cut), false)
    assert.equal(cut, input)
  })

  it('上限を超える位置に絵文字が来たら、その絵文字ごと落とす', () => {
    const input = 'あ'.repeat(20) + '\u{1F5A5}'
    const cut = truncateChars(input, 20)
    assert.equal(hasLoneSurrogate(cut), false)
    assert.equal(cut, 'あ'.repeat(20))
  })

  it('境界にちょうど収まる絵文字は残す', () => {
    const input = 'あ'.repeat(18) + '\u{1F5A5}'
    assert.equal(truncateChars(input, 19), input)
    assert.equal([...truncateChars(input, 19)].length, 19)
  })

  it('数えるのはコードポイント。絵文字は1文字として扱う', () => {
    assert.equal(truncateChars('\u{1F5A5}\u{1F4BB}\u{1F5B1}', 2), '\u{1F5A5}\u{1F4BB}')
  })

  it('ZWJ で終わる形にしない（つなぎだけが残らない）', () => {
    // 👨‍💻 は 👨 + ZWJ + 💻 の3コードポイント
    const input = 'a'.repeat(18) + '\u{1F468}‍\u{1F4BB}'
    assert.equal(truncateChars(input, 20), 'a'.repeat(18) + '\u{1F468}')
  })

  it('異体字セレクタで終わる形にしない', () => {
    assert.equal(truncateChars('ab❤️', 3), 'ab❤')
  })

  it('貼り付けの時点で壊れている末尾は、切らない長さでも落とす', () => {
    const broken = 'デスク' + '\uD83D'
    assert.equal(hasLoneSurrogate(broken), true)
    assert.equal(truncateChars(broken, 30), 'デスク')
  })

  it('0 以下なら空文字', () => {
    assert.equal(truncateChars('あいう', 0), '')
    assert.equal(truncateChars('あいう', -1), '')
  })
})

describe('trimAndTruncate', () => {
  it('前後の空白を落としてから数える', () => {
    assert.equal(trimAndTruncate('  仕事用デスク  ', 30), '仕事用デスク')
  })

  it('空白を落とした結果が上限を超えるときだけ切る', () => {
    assert.equal(trimAndTruncate(' ' + 'あ'.repeat(21) + ' ', 20), 'あ'.repeat(20))
  })
})

describe('trimAndTruncate の下限（見えない文字）', () => {
  it('見えない文字だけの入力は空になる（必須チェックをすり抜けない）', () => {
    assert.equal(trimAndTruncate('​', 20), '')
    assert.equal(trimAndTruncate('​‌⁠﻿', 20), '')
    assert.equal(trimAndTruncate('ㅤㅤ', 20), '')
    assert.equal(trimAndTruncate('　 ​­', 20), '')
  })

  it('両端の見えない文字だけを落とし、中の字と絵文字のつなぎは残す', () => {
    assert.equal(trimAndTruncate('​デスク⁠', 20), 'デスク')
    assert.equal(trimAndTruncate('\u{1F468}‍\u{1F4BB}', 20), '\u{1F468}‍\u{1F4BB}')
  })
})

describe('truncateChars の異体字セレクタ', () => {
  it('直前に字がある異体字セレクタは、切らない長さなら残す（❤️ が ❤ に化けない）', () => {
    assert.equal(truncateChars('❤️', 20), '❤️')
    assert.equal(truncateChars('推しデスク❤️', 30), '推しデスク❤️')
  })

  it('宙に浮いた異体字セレクタ（それだけ・連結子の直後）は落とす', () => {
    assert.equal(truncateChars('️', 20), '')
    assert.equal(truncateChars('a‍️', 20), 'a')
  })
})

describe('inputMaxLength', () => {
  it('上限以内なら上限をそのまま渡す', () => {
    assert.equal(inputMaxLength('abc', 3), 3)
    assert.equal(inputMaxLength(undefined, 3), 3)
    assert.equal(inputMaxLength('abc', undefined), undefined)
  })

  it('上限を超えた値が入っている間は外す（iOS で入力も削除も拒まれて固まるため）', () => {
    assert.equal(inputMaxLength('a'.repeat(101), 100), undefined)
  })

  it('iOS と同じく UTF-16 で数える（絵文字は2）', () => {
    assert.equal(inputMaxLength('😀'.repeat(2), 3), undefined)
    assert.equal(inputMaxLength('😀a', 3), 3)
  })
})

describe('toSingleLine', () => {
  it('改行・タブを空白1つにし、改行の前後の空白もまとめる', () => {
    assert.equal(toSingleLine('Logicool\nMX Keys'), 'Logicool MX Keys')
    assert.equal(toSingleLine('Logicool \r\n MX\tKeys'), 'Logicool MX Keys')
    assert.equal(toSingleLine('a b'), 'a b')
  })

  it('改行もタブも無ければそのまま返す（全角空白や連続した空白は触らない）', () => {
    assert.equal(toSingleLine('山田　太郎'), '山田　太郎')
    assert.equal(toSingleLine('a  b'), 'a  b')
  })
})

describe('tidyMultilineText', () => {
  it('両端の空白・空行を落とす', () => {
    assert.equal(tidyMultilineText('\n\n  説明  \n\n'), '説明')
  })

  it('空行が2行以上続くところは1行にまとめる', () => {
    assert.equal(tidyMultilineText('1行目\n\n\n\n2行目'), '1行目\n\n2行目')
  })

  it('行末の空白を消し、CRLF を LF にそろえる', () => {
    assert.equal(tidyMultilineText('1行目  \r\n2行目　\r\n3行目'), '1行目\n2行目\n3行目')
  })

  it('空白と改行だけなら空になる', () => {
    assert.equal(tidyMultilineText(' \n\t\n　'), '')
  })
})
