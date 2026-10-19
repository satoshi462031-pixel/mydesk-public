import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cableChoiceLabel } from '../src/utils/cableChoice'

describe('cableChoiceLabel', () => {
  it('未設定は「本体付属」に読み替えない', () => {
    // 既定を付属にすると、家にあった別の1本を使っている人のデスクにも
    // 「付属」と書いて公開することになる
    assert.equal(cableChoiceLabel(undefined, 'ja'), undefined)
    assert.equal(cableChoiceLabel(undefined, 'en'), undefined)
  })

  it('申告があれば言語ごとの表記を返す', () => {
    assert.equal(cableChoiceLabel({ kind: 'included' }, 'ja'), '本体付属')
    assert.equal(cableChoiceLabel({ kind: 'included' }, 'en'), 'Included cable')
  })

  it('商品はそのままの名前を出す', () => {
    const choice = { kind: 'product' as const, name: 'Anker USB-C 240W 0.9m', productId: 'p1' }
    assert.equal(cableChoiceLabel(choice, 'ja'), 'Anker USB-C 240W 0.9m')
    assert.equal(cableChoiceLabel({ kind: 'product', name: '   ' }, 'ja'), undefined)
  })
})
