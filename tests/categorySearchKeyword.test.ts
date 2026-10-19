import assert from 'node:assert/strict'
import test from 'node:test'
import { categorySearchKeyword, CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../src/constants/categoryLabels'
import { GadgetCategory } from '../src/types'

// テンプレートの枠に出るジャンル。ここに語が無いと「探す」導線が出ない
const TEMPLATE_CATEGORIES: GadgetCategory[] = [
  'PC', 'Monitor', 'Mouse', 'Keyboard', 'Desk', 'Chair', 'PowerStrip', 'Charger', 'Speaker', 'Light', 'Earphone', 'MobileBattery',
]

test('テンプレートに出るジャンルには検索語がある', () => {
  for (const category of TEMPLATE_CATEGORIES) {
    assert.ok(categorySearchKeyword(category, 'ja'), category)
    assert.ok(categorySearchKeyword(category, 'en'), category)
  }
})

// productRepository はカテゴリ名そのものを「枠の名前」と見なして購入リンクを返さない。
// ラベルと同じ語を返すと、導線を出しても必ず空になる
test('ジャンル名そのままにはしない', () => {
  for (const category of Object.keys(CATEGORY_LABELS) as GadgetCategory[]) {
    const ja = categorySearchKeyword(category, 'ja')
    if (ja) assert.notEqual(ja, CATEGORY_LABELS[category], category)
    const en = categorySearchKeyword(category, 'en')
    if (en) assert.notEqual(en, CATEGORY_LABELS_EN[category], category)
  }
})

// productRepository の PLACEHOLDER_PRODUCT_NAMES には、ジャンル名のほかに
// 「商品ではなく種類を表すだけのプリセット行」も入っている。ここと衝突しても
// 購入リンクは返らないので、同じ語を検索に使わない
const EXTRA_PLACEHOLDER_NAMES = ['ノートパソコン', 'デスクトップPC', 'ケーブルモデム', '充電器を追加']

test('プリセットの種類名とも衝突しない', () => {
  for (const category of Object.keys(CATEGORY_LABELS) as GadgetCategory[]) {
    const keyword = categorySearchKeyword(category, 'ja')
    if (keyword) assert.ok(!EXTRA_PLACEHOLDER_NAMES.includes(keyword), `${category}: ${keyword}`)
  }
})

test('括弧書きの補足を検索語に持ち込まない', () => {
  for (const category of Object.keys(CATEGORY_LABELS) as GadgetCategory[]) {
    const keyword = categorySearchKeyword(category, 'ja')
    if (keyword) assert.ok(!/[（(]/.test(keyword), `${category}: ${keyword}`)
  }
})

// 一般名で探しても仕方がないジャンルには語を置かない
test('探しても意味のないジャンルには語を置かない', () => {
  for (const category of ['Other', 'Smartphone', 'PCPart', 'Cable', 'Plant'] as GadgetCategory[]) {
    assert.equal(categorySearchKeyword(category, 'ja'), null, category)
  }
})
