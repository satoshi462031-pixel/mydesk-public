import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildGadgetSearchIndex,
  matchesGadgetSearch,
  normalizeGadgetSearch,
  SearchableGadget,
  searchTerms,
} from '../src/utils/gadgetSearch'

const label = (category: string) => (category === 'Keyboard' ? 'キーボード' : category)

const gadgets: SearchableGadget[] = [
  { id: 'a', name: 'HHKB Professional', category: 'Keyboard' },
  { id: 'b', name: 'ＭＸ Ｍａｓｔｅｒ ３Ｓ', category: 'Mouse', memo: '静音' },
  { id: 'c', name: 'LG UltraFine', category: 'Monitor', memo: 'ＵＳＢ－Ｃ 接続' },
]

const index = buildGadgetSearchIndex(gadgets, label)
const hit = (query: string) =>
  gadgets.filter((g) => matchesGadgetSearch(index, g.id, normalizeGadgetSearch(query))).map((g) => g.id)

describe('normalizeGadgetSearch', () => {
  it('全角英数を半角へ寄せて小文字にする', () => {
    assert.equal(normalizeGadgetSearch('  ＨＨＫＢ '), 'hhkb')
  })

  it('半角カナを全角カナへ寄せる', () => {
    assert.equal(normalizeGadgetSearch('ｷｰﾎﾞｰﾄﾞ'), 'キーボード')
  })
})

describe('matchesGadgetSearch', () => {
  it('半角で入力した名前が全角で登録された商品に当たる', () => {
    assert.deepEqual(hit('MX Master'), ['b'])
  })

  it('全角で入力した名前が半角で登録された商品に当たる', () => {
    assert.deepEqual(hit('ＨＨＫＢ'), ['a'])
  })

  it('半角カナでカテゴリ名を引ける', () => {
    assert.deepEqual(hit('ｷｰﾎﾞｰﾄﾞ'), ['a'])
  })

  it('メモの全角表記も正規化して当たる', () => {
    assert.deepEqual(hit('USB-C'), ['c'])
  })

  it('大文字小文字は区別しない', () => {
    assert.deepEqual(hit('hhkb'), ['a'])
  })

  it('空の検索語はすべて通す', () => {
    assert.deepEqual(hit('   '), ['a', 'b', 'c'])
  })

  it('索引に無い id は当たらない', () => {
    assert.equal(matchesGadgetSearch(index, 'missing', 'hhkb'), false)
  })

  it('語の間の空白の数・全角空白・改行・タブを問わない', () => {
    assert.deepEqual(hit('HHKB   Professional'), ['a'])
    assert.deepEqual(hit('HHKB　Professional'), ['a'])
    assert.deepEqual(hit('HHKB\nProfessional'), ['a'])
    assert.deepEqual(hit('HHKB\tProfessional'), ['a'])
  })

  it('語の順番を問わず、すべての語を含むものだけ当たる', () => {
    assert.deepEqual(hit('Professional HHKB'), ['a'])
    assert.deepEqual(hit('HHKB Mouse'), [])
  })

  it('改行・タブだけの検索語はすべて通す', () => {
    assert.deepEqual(hit('\n\t　'), ['a', 'b', 'c'])
  })
})

describe('searchTerms', () => {
  it('空白類で区切り、空の語を落とす', () => {
    assert.deepEqual(searchTerms(normalizeGadgetSearch('  MX　 Keys\n')), ['mx', 'keys'])
  })
})
