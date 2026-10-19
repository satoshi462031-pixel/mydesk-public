import test from 'node:test'
import assert from 'node:assert/strict'
import { keyboardRevealDelta } from '../src/utils/keyboardReveal'

// iPhone SE 相当：ヘッダーの下 64pt からスクロール領域、キーボードの上端 407pt
const base = { scrollY: 64, scrollHeight: 603, keyboardY: 407, bottomInset: 0, margin: 12 }

test('キーボードより上に見えている欄は動かさない', () => {
  assert.equal(keyboardRevealDelta({ ...base, fieldY: 200, fieldHeight: 44 }), 0)
})

test('キーボードに隠れた欄は、隠れている分だけ送る', () => {
  // 欄の下端＋余白 = 500 + 44 + 12 = 556、見える下端 407
  assert.equal(keyboardRevealDelta({ ...base, fieldY: 500, fieldHeight: 44 }), 149)
})

test('スクロール領域がキーボード分縮んでいれば、その下端で測る', () => {
  assert.equal(keyboardRevealDelta({ ...base, scrollHeight: 300, keyboardY: 600, fieldY: 330, fieldHeight: 44 }), 22)
})

test('下部バーが重なっている分も隠れているとみなす', () => {
  assert.equal(keyboardRevealDelta({ ...base, bottomInset: 80, fieldY: 300, fieldHeight: 44 }), 29)
})

test('見える高さより背の高い欄は、上端が領域の上端に来るところで止める', () => {
  // 下端で合わせると 64 + 12 より上へ欄の上端が消える
  assert.equal(keyboardRevealDelta({ ...base, fieldY: 150, fieldHeight: 400 }), 74)
})
