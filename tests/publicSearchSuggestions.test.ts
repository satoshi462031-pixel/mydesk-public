import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSearchVocabulary,
  correctSearchQuery,
  foldSearchText,
  relatedSearchTerms,
  suggestSearchTerms,
} from '../src/utils/publicSearchSuggestions'

const purposes = [
  { key: 'gaming', ja: 'ゲーミング', en: 'Gaming' },
  { key: 'work', ja: '仕事', en: 'Work' },
]
const gear = [
  { name: 'Logicool MX Master 3S', category: 'Mouse', desk_count: 5 },
  { name: 'MacBook Pro 14', category: 'PC', desk_count: 3 },
  { name: 'HHKB Professional HYBRID', category: 'Keyboard', desk_count: 2 },
]
const ja = buildSearchVocabulary({ lang: 'ja', purposes, gear })
const en = buildSearchVocabulary({ lang: 'en', purposes, gear })

const labels = (input: string, vocabulary = ja) => suggestSearchTerms(input, vocabulary).map((s) => s.query)

test('ひらがな・全角・大文字の違いを畳む', () => {
  assert.equal(foldSearchText('ろじくーる'), foldSearchText('ロジクール'))
  assert.equal(foldSearchText('ＬＯＧＩ'), 'logi')
  assert.equal(foldSearchText('MX Master'), 'mxmaster')
})

test('打ちかけの語は続きを出す', () => {
  assert.ok(labels('ろじく').includes('ロジクール'))
  assert.ok(labels('キーボ').includes('キーボード'))
  assert.ok(labels('logi', en).includes('Logitech'))
})

test('語の途中から打っても機材名に当てる', () => {
  assert.ok(labels('master').includes('Logicool MX Master 3S'))
  assert.ok(labels('pro').includes('MacBook Pro 14'))
})

test('打ち間違いは近い語を出す', () => {
  assert.ok(labels('keybord', en).includes('Keyboard'))
  assert.ok(labels('moniter', en).includes('Monitor'))
  assert.ok(labels('logitek', en).includes('Logitech'))
  assert.ok(labels('ロジクル').includes('ロジクール'))
})

test('英語で打っても日本語の表示名で出す（照合は両方の表記で行う）', () => {
  assert.ok(labels('keyboar').includes('キーボード'))
})

test('続きの候補を打ち間違いの候補より上に置く', () => {
  const result = suggestSearchTerms('mous', en)
  assert.equal(result[0].query, 'Mouse')
  assert.equal(result[0].corrected, false)
})

test('短い英字では打ち間違いを許さない（別の語に化ける）', () => {
  assert.ok(!labels('moi', en).includes('Mouse'))
  assert.deepEqual(labels('x', en), [])
})

test('打った語そのものは候補に出さない', () => {
  assert.ok(!labels('キーボード').includes('キーボード'))
  assert.ok(!labels('logicool', en).includes('Logitech'))
})

test('複数の語は最後の語だけを差し替えた候補も出す', () => {
  assert.ok(labels('ゲーミング きーぼ').includes('ゲーミング キーボード'))
  assert.ok(labels('gaming keybord', en).includes('gaming Keyboard'))
})

test('0件のときの言い直しは打ち間違いの語だけを差し替える', () => {
  assert.equal(correctSearchQuery('keybord', en), 'Keyboard')
  assert.equal(correctSearchQuery('white keybord', en), 'white Keyboard')
  // 辞書の語そのもの・打ちかけは打ち間違いではない
  assert.equal(correctSearchQuery('keyboard', en), null)
  assert.equal(correctSearchQuery('keyb', en), null)
  assert.equal(correctSearchQuery('zzzzzz', en), null)
})

test('近いジャンル・ブランドは検索語そのものを外して使われている順に並べる', () => {
  const hits = [
    { name: 'Logicool MX Master 3S', category: 'Mouse', desk_count: 5, brand: 'Logitech' },
    { name: 'Logicool MX Keys', category: 'Keyboard', desk_count: 3, brand: 'Logitech' },
    { name: 'Logicool C920', category: 'Webcam', desk_count: 1, brand: 'Logitech' },
  ]
  assert.deepEqual(
    relatedSearchTerms('ロジクール', hits, 'ja').map((t) => `${t.kind}:${t.label}`),
    ['category:マウス', 'category:キーボード', 'category:Webカメラ'],
  )
  const keyboards = [
    { name: 'HHKB Professional', category: 'Keyboard', desk_count: 2, brand: 'PFU' },
    { name: 'Logicool MX Keys', category: 'Keyboard', desk_count: 4, brand: 'Logitech' },
  ]
  assert.deepEqual(
    relatedSearchTerms('keyboard', keyboards, 'en').map((t) => `${t.kind}:${t.label}`),
    ['brand:Logitech', 'brand:PFU'],
  )
})
