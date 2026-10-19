import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { affiliateDisclosure, isAffiliateUrl, withoutAffiliateUrl } from '../src/utils/url'

const RAKUTEN_AFL = 'https://hb.afl.rakuten.co.jp/hgc/g00rr09n.vmi33b9e.g00rr09n.vmi34ec1/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fanker%2Fa9215%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fanker%2Fi%2F10002530%2F&rafcid=wsc_i_is_x'

describe('withoutAffiliateUrl', () => {
  it('楽天の中継URLは商品URLへ戻す', () => {
    assert.equal(withoutAffiliateUrl(RAKUTEN_AFL), 'https://item.rakuten.co.jp/anker/a9215/')
  })

  it('商品URLを取り出せない中継URLは出さない', () => {
    assert.equal(withoutAffiliateUrl('https://hb.afl.rakuten.co.jp/hgc/abc/'), null)
  })

  it('楽天の rafcid と Amazon の tag だけを外し、他の引数は残す', () => {
    assert.equal(
      withoutAffiliateUrl('https://search.rakuten.co.jp/search/mall/%E3%83%9E%E3%82%A6%E3%82%B9/?rafcid=abc'),
      'https://search.rakuten.co.jp/search/mall/%E3%83%9E%E3%82%A6%E3%82%B9/',
    )
    assert.equal(
      withoutAffiliateUrl('https://www.amazon.co.jp/s?k=mouse&tag=mydesk-22'),
      'https://www.amazon.co.jp/s?k=mouse',
    )
  })

  it('Amazon 以外の tag は外さない', () => {
    const url = 'https://example.com/item?tag=red'
    assert.equal(withoutAffiliateUrl(url), url)
  })

  it('中身の見えない Amazon の短縮URLは出さない', () => {
    assert.equal(withoutAffiliateUrl('https://amzn.to/3abcDEF'), null)
  })

  it('報酬の印が無いURLは文字列ごとそのまま返す', () => {
    const url = 'https://www.amazon.co.jp/dp/B0B117PZ3S?th=1'
    assert.equal(withoutAffiliateUrl(url), url)
    assert.equal(isAffiliateUrl(url), false)
  })
})

describe('affiliateDisclosure', () => {
  it('報酬の付いたリンクが無ければ表示しない', () => {
    assert.equal(affiliateDisclosure([{ shop: 'rakuten_jp', url: 'https://item.rakuten.co.jp/anker/a9215/', kind: 'product' }], 'ja'), null)
  })

  it('報酬の付いたリンクがあれば表示する', () => {
    assert.ok(affiliateDisclosure([{ shop: 'rakuten_jp', url: RAKUTEN_AFL, kind: 'product' }], 'ja'))
  })
})
