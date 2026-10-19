import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeDigitsInput, sanitizeNumericInput } from '../src/utils/numericInput'
import { decodeDeskId, encodeDeskId, isShortDeskId, isUuid } from '../src/utils/shortDeskId'
import { isAffiliateUrl, normalizeHttpUrl, shopLabelForUrl } from '../src/utils/url'
import { buildPublicProfileUrl, buildPublicUrl, parsePublicDeskUrl } from '../src/constants/plans'
import { resolvePurchaseLinks, resolvePurchaseLinksSync, resolvePurchaseUrlSync } from '../src/repositories/productRepository'

describe('numeric input normalization', () => {
  it('normalizes full-width digits and keeps only the first decimal point', () => {
    assert.equal(sanitizeNumericInput('１２．３.４cm'), '12.34')
    assert.equal(sanitizeNumericInput('20円'), '20')
    assert.equal(sanitizeNumericInput('..5'), '.5')
  })

  it('keeps digits only for integer fields', () => {
    assert.equal(sanitizeDigitsInput('２０２６年08月'), '202608')
    assert.equal(sanitizeDigitsInput('-12.5'), '125')
    assert.equal(sanitizeDigitsInput('abc'), '')
  })
})

describe('external URL normalization', () => {
  it('adds https to a host and preserves valid http(s) URLs', () => {
    assert.equal(normalizeHttpUrl(' example.com/item?q=desk '), 'https://example.com/item?q=desk')
    assert.equal(normalizeHttpUrl('http://example.com'), 'http://example.com/')
  })

  it('rejects executable, malformed, and credential-bearing URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,test', 'https://', 'https://user:pass@example.com']) {
      assert.equal(normalizeHttpUrl(value), null)
    }
    assert.equal(normalizeHttpUrl(''), null)
    assert.equal(normalizeHttpUrl(null), null)
  })

  it('labels known shops without exposing long affiliate URLs', () => {
    assert.equal(shopLabelForUrl('https://hb.afl.rakuten.co.jp/hgc/example', 'ja'), '楽天の商品ページ（広告）')
    assert.equal(shopLabelForUrl('https://www.amazon.co.jp/dp/example', 'en'), 'Amazon product page')
    assert.equal(shopLabelForUrl('https://www.amazon.co.jp/dp/example?tag=mydesk-22', 'en'), 'Amazon product page (Ad)')
    assert.equal(shopLabelForUrl('not a url', 'ja'), '商品ページ')
  })

  it('identifies affiliate URLs without treating ordinary product URLs as ads', () => {
    assert.equal(isAffiliateUrl('https://hb.afl.rakuten.co.jp/hgc/example'), true)
    assert.equal(isAffiliateUrl('https://search.rakuten.co.jp/search/mall/desk/?rafcid=example'), true)
    assert.equal(isAffiliateUrl('https://www.amazon.co.jp/dp/example?tag=mydesk-22'), true)
    assert.equal(isAffiliateUrl('https://www.amazon.co.jp/dp/example'), false)
    assert.equal(isAffiliateUrl('https://example.com/product?tag=desk'), false)
  })

  it('ignores user-entered URLs when resolving a public catalog link', () => {
    const target = { name: 'Custom gadget', url: 'https://example.com/user-link' }
    assert.equal(resolvePurchaseUrlSync(target), 'https://example.com/user-link')
    assert.equal(resolvePurchaseUrlSync(target, { catalogOnly: true }), null)
  })

  it('デモ機材には商品ID・保存済みURL・名前による検索のいずれからも購入リンクを出さない', async () => {
    for (const target of [
      { id: 'demo-gaming-monitor', name: 'Dell U2723QE', productId: 'catalog-monitor' },
      { id: 'demo-gaming-monitor', name: 'Dell U2723QE', url: 'https://example.com/product' },
      { id: 'demo-gaming-monitor', name: 'Dell U2723QE' },
    ]) {
      for (const country of ['JP', 'US'] as const) {
        for (const catalogOnly of [true, false]) {
          assert.deepEqual(resolvePurchaseLinksSync(target, { country, catalogOnly }), [])
          assert.deepEqual(await resolvePurchaseLinks(target, { country, catalogOnly }), [])
        }
      }
    }
  })

  it('デモと同名でも通常の機材に保存したリンクは残す', async () => {
    const target = { id: 'user-monitor', name: 'Dell U2723QE', url: 'https://example.com/product' }
    assert.equal(resolvePurchaseLinksSync(target)[0]?.url, target.url)
    assert.equal((await resolvePurchaseLinks(target))[0]?.url, target.url)
  })
})

describe('short desk IDs', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000'

  it('round-trips UUIDs through the canonical 22-character form', () => {
    const short = encodeDeskId(uuid)
    assert.equal(short.length, 22)
    assert.equal(isShortDeskId(short), true)
    assert.equal(decodeDeskId(short), uuid)
  })

  it('leaves invalid input unchanged', () => {
    assert.equal(isUuid(uuid), true)
    assert.equal(isUuid('not-a-uuid'), false)
    assert.equal(encodeDeskId('not-a-uuid'), 'not-a-uuid')
    assert.equal(decodeDeskId('short'), 'short')
  })
})

describe('public desk URLs', () => {
  const uuid = '11111111-2222-4333-8444-555555555555'
  const short = encodeDeskId(uuid)

  it('投稿者の @ID を載せ、末尾を削るとプロフィールになる形で組む', () => {
    const url = buildPublicUrl(uuid, 'desk_ashford')
    assert.equal(url, `https://mydesk.page/desk_ashford/${short}`)
    assert.equal(url.slice(0, url.lastIndexOf('/')), buildPublicProfileUrl('desk_ashford'))
    assert.equal(parsePublicDeskUrl(url), uuid)
    assert.equal(parsePublicDeskUrl(`${url}/?utm_source=test#desk`), uuid)
  })

  // 公式アカウント（@MyDesk）は予約語だが実在する。名乗れない綴りとして弾かない
  it('公式アカウントの @ID もそのまま載せる', () => {
    assert.equal(buildPublicUrl(uuid, '@MyDesk'), `https://mydesk.page/MyDesk/${short}`)
  })

  // @ID を載せられないときに /terms/<ID> のような形を作らない
  it('@ID が無い・サイト自身のパスと同じ綴りなら旧形式で組む', () => {
    assert.equal(buildPublicUrl(uuid), `https://mydesk.page/setup/${short}`)
    assert.equal(buildPublicUrl(uuid, ''), `https://mydesk.page/setup/${short}`)
    assert.equal(buildPublicUrl(uuid, 'terms'), `https://mydesk.page/setup/${short}`)
    assert.equal(buildPublicUrl(uuid, 'has-hyphen'), `https://mydesk.page/setup/${short}`)
  })

  it('keeps supported legacy URL formats', () => {
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/setup/${short}`), uuid)
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/setup/${uuid}`), uuid)
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/desk/${uuid}`), uuid)
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/d/${short}`), uuid)
  })

  it('rejects another host, malformed IDs, and extra path segments', () => {
    assert.equal(parsePublicDeskUrl(`https://example.com/setup/${short}`), null)
    assert.equal(parsePublicDeskUrl('https://mydesk.page/setup/not-an-id'), null)
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/setup/${short}/extra`), null)
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/desk_ashford/${short}/extra`), null)
    // サイト自身のパスは @ID として読まない
    assert.equal(parsePublicDeskUrl(`https://mydesk.page/terms/${short}`), null)
  })
})

describe('public profile url', () => {
  // 060 から @ID は本人が決める。印だけ落として綴りはそのまま載せる
  // （照合する側 — worker とアプリ — が大文字小文字を区別しない）
  it('strips the marker without rewriting the spelling', () => {
    assert.equal(buildPublicProfileUrl('MyDesk'), 'https://mydesk.page/MyDesk')
    assert.equal(buildPublicProfileUrl('@A1B2C3'), 'https://mydesk.page/A1B2C3')
    assert.equal(buildPublicProfileUrl(' #desk_ashford '), 'https://mydesk.page/desk_ashford')
  })
})
