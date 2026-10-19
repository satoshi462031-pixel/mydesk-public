import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupPriceDraft, normalizeDimensionInput, orderedRange, priceDraftAfterEdit, sanitizeNumericInput } from '../src/utils/numericInput'

describe('groupPriceDraft（金額の3桁区切り）', () => {
  it('整数部に3桁ごとのカンマを入れる', () => {
    assert.equal(groupPriceDraft('198000'), '198,000')
    assert.equal(groupPriceDraft('1980000'), '1,980,000')
    assert.equal(groupPriceDraft('999'), '999')
    assert.equal(groupPriceDraft(''), '')
  })

  it('小数と打ちかけの小数点はそのまま残す', () => {
    assert.equal(groupPriceDraft('1299.99'), '1,299.99')
    assert.equal(groupPriceDraft('1299.'), '1,299.')
    assert.equal(groupPriceDraft('.5'), '.5')
  })

  it('表示した値を打ち直しても元の数字に戻る', () => {
    assert.equal(sanitizeNumericInput(groupPriceDraft('1980000') + '1'), '19800001')
  })
})

describe('normalizeDimensionInput（寸法の下限）', () => {
  it('数字の無い値・0 以下は未入力として扱う', () => {
    assert.equal(normalizeDimensionInput(''), undefined)
    assert.equal(normalizeDimensionInput('.'), undefined)
    assert.equal(normalizeDimensionInput('0'), undefined)
    assert.equal(normalizeDimensionInput('0.0'), undefined)
  })

  it('打っている途中の形と先頭ゼロを数値の形に揃える', () => {
    assert.equal(normalizeDimensionInput('120.'), '120')
    assert.equal(normalizeDimensionInput('070'), '70')
    assert.equal(normalizeDimensionInput('72.5'), '72.5')
  })

  it('全角数字や単位が混ざっても数値だけを残す', () => {
    assert.equal(normalizeDimensionInput('１２０cm'), '120')
  })
})

describe('orderedRange', () => {
  it('最小が最大より大きければ入れ替える', () => {
    assert.deepEqual(orderedRange('120', '70'), { min: '70', max: '120' })
  })

  it('正しい順・片方だけのときはそのまま', () => {
    assert.deepEqual(orderedRange('70', '120'), { min: '70', max: '120' })
    assert.deepEqual(orderedRange('70', undefined), { min: '70', max: undefined })
    assert.deepEqual(orderedRange(undefined, undefined), { min: undefined, max: undefined })
  })
})

describe('sanitizeNumericInput', () => {
  it('小数点は最初の1つだけ残す', () => {
    assert.equal(sanitizeNumericInput('1.2.3'), '1.23')
  })
})

describe('priceDraftAfterEdit（区切りのある金額欄の編集）', () => {
  it('区切りの直後で Backspace を押したら、区切りの前の数字を消す', () => {
    assert.equal(priceDraftAfterEdit('198,000', '198000'), '19000')
    assert.equal(priceDraftAfterEdit('1,980', '1980'), '980')
    assert.equal(priceDraftAfterEdit('1,234,567', '1,234567'), '123567')
  })

  it('数字を消した・足した編集はそのまま受ける', () => {
    assert.equal(priceDraftAfterEdit('198,000', '198,00'), '19800')
    assert.equal(priceDraftAfterEdit('1,980', '1,90'), '190')
    assert.equal(priceDraftAfterEdit('1,980', '1,9805'), '19805')
    assert.equal(priceDraftAfterEdit('', '5'), '5')
    assert.equal(priceDraftAfterEdit('5', ''), '')
  })

  it('小数と全角数字は sanitizeNumericInput と同じ扱い', () => {
    assert.equal(priceDraftAfterEdit('1,234.5', '1234.5'), '234.5')
    assert.equal(priceDraftAfterEdit('12', '12３'), '123')
  })
})
