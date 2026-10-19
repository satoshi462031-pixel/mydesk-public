import assert from 'node:assert/strict'
import test from 'node:test'
import { cableSearchKeyword } from '../src/constants/portTypes'
import { CableType } from '../src/types'

// cableLabel をそのまま検索に投げると「USB-C ↔ HDMI」「コンセント ↔ 機器」になり
// 1件も出ない。商品として呼ばれている語になっているかを見る
test('両端をつなぐ記号と穴埋め語を落として検索語にする', () => {
  const cases: Array<[CableType, string]> = [
    ['HDMI', 'HDMI ケーブル'],
    ['USB_C_to_HDMI', 'USB-C HDMI ケーブル'],
    ['Power', '電源ケーブル'],
    ['USB_A', 'USB-A ケーブル'],
    ['SpeakerTerminal', 'スピーカーケーブル'],
  ]
  for (const [type, expected] of cases) assert.equal(cableSearchKeyword(type, 'ja'), expected, type)
})

test('「ケーブル」を二重に付けない', () => {
  for (const type of ['SpeakerTerminal', 'CoaxialAudio', 'Audio4_4mm', 'XLR4pin'] as CableType[]) {
    const keyword = cableSearchKeyword(type, 'ja')
    assert.equal(keyword.split('ケーブル').length - 1, 1, `${type}: ${keyword}`)
  }
})

test('英語でも同じ形になる', () => {
  assert.equal(cableSearchKeyword('HDMI', 'en'), 'HDMI cable')
  assert.equal(cableSearchKeyword('Power', 'en'), 'power cable')
  assert.equal(cableSearchKeyword('SpeakerTerminal', 'en'), 'Speaker cable')
})

// 検索語に記号や穴埋め語が残っていないこと（新しい CableType が増えたときの網
test('どの種類でも記号と穴埋め語が残らない', () => {
  const types: CableType[] = ['HDMI', 'DisplayPort', 'USB_C', 'USB_B', 'Lightning', 'microUSB', 'Ethernet', 'Power', 'Audio3_5mm', 'XLR', 'MIDI', 'RCA', 'USB_A_to_B', 'HDMI_to_DVI', 'DCPower']
  for (const type of types) {
    const keyword = cableSearchKeyword(type, 'ja')
    assert.ok(!keyword.includes('↔'), `${type}: ${keyword}`)
    assert.ok(!keyword.includes('機器'), `${type}: ${keyword}`)
    assert.ok(!/\s{2,}/.test(keyword), `${type}: ${keyword}`)
  }
})
