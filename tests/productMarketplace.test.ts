import assert from 'node:assert/strict'
import test from 'node:test'
import { productMarketplace, productMarketplaceLabel } from '../src/utils/productMarketplace'

test('商品DBのショップ識別子からAmazonと楽天を判定する', () => {
  assert.equal(productMarketplace({ name: 'A', shop: 'amazon_jp' }), 'amazon')
  assert.equal(productMarketplace({ name: 'B', shop: 'rakuten_jp' }), 'rakuten')
  assert.equal(productMarketplaceLabel({ name: 'B', shop: 'rakuten_jp' }, 'ja'), '楽天市場')
})

test('既存プリセットは購入URLからショップを判定する', () => {
  assert.equal(productMarketplace({ name: 'A', affiliateUrl: 'https://amzn.to/example' }), 'amazon')
  assert.equal(productMarketplace({ name: 'B', officialUrl: 'https://item.rakuten.co.jp/shop/item' }), 'rakuten')
})

test('Amazon・楽天に紐付かない候補は対象外にする', () => {
  assert.equal(productMarketplace({ name: 'Official', shop: 'official', officialUrl: 'https://example.com' }), null)
  assert.equal(productMarketplace({ name: 'No link' }), null)
})
