import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { multilineInputText } from '../src/utils/multilineInputText'

describe('multilineInputText', () => {
  it('iOS では lineHeight の余りの半分だけ上の余白を下へ回す', () => {
    // SF Pro 15pt の行の高さは 17.90。余り 4.10 の半分 2.05 を動かす
    const style = multilineInputText({ fontSize: 15, lineHeight: 22, paddingTop: 7, paddingBottom: 7 }, 'ios')
    assert.ok(Math.abs(style.paddingTop - 4.95) < 0.01)
    assert.ok(Math.abs(style.paddingBottom - 9.05) < 0.01)
    assert.equal(style.paddingTop + style.paddingBottom, 14)
    assert.equal(style.lineHeight, 22)
    assert.equal(style.fontSize, 15)
  })

  it('iOS 以外は <Text> と同じく中央に描かれるので変えない', () => {
    const text = { fontSize: 15, lineHeight: 22, paddingTop: 7, paddingBottom: 7 }
    assert.deepEqual(multilineInputText(text, 'android'), text)
    assert.deepEqual(multilineInputText(text, 'web'), text)
  })

  it('lineHeight が字の高さ以下なら変えない', () => {
    const text = { fontSize: 15, lineHeight: 17, paddingTop: 7, paddingBottom: 7 }
    assert.deepEqual(multilineInputText(text, 'ios'), text)
  })

  it('上の余白より多くは動かさない', () => {
    const style = multilineInputText({ fontSize: 13, lineHeight: 30, paddingTop: 2, paddingBottom: 2 }, 'ios')
    assert.equal(style.paddingTop, 0)
    assert.equal(style.paddingBottom, 4)
  })
})
