import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findPackageForPlan, isPlanActive, resolveSubscriptionTier, subscriptionStatusLabel, yearlyPriceNote } from '../src/utils/purchasePackages'
import { PAYWALL_PLANS } from '../src/constants/plans'

describe('subscription tier resolution', () => {
  it('uses RevenueCat once CustomerInfo has been loaded', () => {
    assert.equal(resolveSubscriptionTier('free', true, 'pro'), 'free')
    assert.equal(resolveSubscriptionTier('pro', true, 'free'), 'pro')
  })

  it('uses the server profile only while RevenueCat status is unavailable', () => {
    assert.equal(resolveSubscriptionTier('free', false, 'pro'), 'pro')
    assert.equal(resolveSubscriptionTier('free', false, 'free'), 'free')
  })

  it('treats the official demo account as Pro without a store entitlement', () => {
    assert.equal(resolveSubscriptionTier('free', true, 'free', true), 'pro')
  })
})

describe('RevenueCat package matching', () => {
  it('matches Android base-plan identifiers', () => {
    const plan = { ...PAYWALL_PLANS[0], productId: 'mydesk.pro.monthly' }
    const pkg = { packageType: 'MONTHLY', product: { identifier: 'mydesk.pro.monthly:monthly' } }
    assert.equal(findPackageForPlan([pkg], plan), pkg)
  })

  it('falls back to the RevenueCat package type when product IDs are not configured', () => {
    const plan = { ...PAYWALL_PLANS[1], productId: '' }
    const pkg = { packageType: 'ANNUAL', product: { identifier: 'configured.remotely' } }
    assert.equal(findPackageForPlan([pkg], plan), pkg)
  })
})

describe('active plan detection', () => {
  const info = { activeSubscriptions: ['mydesk.pro.monthly:monthly'] }

  it('matches through the configured product ID', () => {
    const monthly = { ...PAYWALL_PLANS[0], productId: 'mydesk.pro.monthly' }
    const yearly = { ...PAYWALL_PLANS[1], productId: 'mydesk.pro.yearly' }
    assert.equal(isPlanActive(info, monthly), true)
    assert.equal(isPlanActive(info, yearly), false)
  })

  // 購入は環境変数が空でもパッケージ種別で通るので、判定も同じ照合で引き当てる
  it('matches through the package type when product IDs are not configured', () => {
    const monthly = { ...PAYWALL_PLANS[0], productId: '' }
    const yearly = { ...PAYWALL_PLANS[1], productId: '' }
    const packages = [
      { packageType: 'MONTHLY', product: { identifier: 'mydesk.pro.monthly' } },
      { packageType: 'ANNUAL', product: { identifier: 'mydesk.pro.yearly' } },
    ]
    assert.equal(isPlanActive(info, monthly, packages), true)
    assert.equal(isPlanActive(info, yearly, packages), false)
    assert.equal(isPlanActive(info, monthly), false)
  })
})

describe('yearly price note', () => {
  const yearly = { price: 5900, currencyCode: 'JPY', pricePerMonthString: '¥491' }
  const monthly = { price: 590, currencyCode: 'JPY' }

  it('uses the store per-month price and the real saving', () => {
    assert.equal(yearlyPriceNote(yearly, monthly, 'ja'), '月あたり ¥491（17%お得）')
    assert.equal(yearlyPriceNote(yearly, monthly, 'en'), '¥491 / mo — save 17%')
  })

  // 日本のストアで英語表示でも、ストアの通貨のまま出す（固定文言の $3.33 を並べない）
  it('never mixes in a hard-coded currency', () => {
    assert.doesNotMatch(yearlyPriceNote(yearly, monthly, 'en') ?? '', /\$/)
  })

  it('does not claim a saving across currencies', () => {
    assert.equal(yearlyPriceNote(yearly, { price: 3.99, currencyCode: 'USD' }, 'ja'), '月あたり ¥491')
  })

  it('returns null when nothing can be computed', () => {
    assert.equal(yearlyPriceNote({ price: 5900, currencyCode: 'JPY', pricePerMonthString: null }, undefined, 'ja'), null)
  })
})

describe('subscription status label', () => {
  const proInfo = (entitlement: Record<string, unknown>) => ({
    entitlements: { active: { pro: entitlement } },
  })

  it('says nothing for free users', () => {
    assert.equal(subscriptionStatusLabel(proInfo({ expirationDate: '2026-10-01T00:00:00Z' }), 'free', 'ja'), null)
  })

  it('says nothing when no expiration is known', () => {
    assert.equal(subscriptionStatusLabel({ entitlements: { active: {} } }, 'pro', 'ja'), null)
    assert.equal(subscriptionStatusLabel(null, 'pro', 'ja'), null)
  })

  it('ignores an unparsable expiration instead of printing Invalid Date', () => {
    assert.equal(subscriptionStatusLabel(proInfo({ expirationDate: 'someday' }), 'pro', 'ja'), null)
  })

  it('distinguishes a trial from a renewal', () => {
    const trial = proInfo({ expirationDate: '2026-10-01T09:00:00Z', periodType: 'TRIAL', willRenew: true })
    assert.match(subscriptionStatusLabel(trial, 'pro', 'ja') ?? '', /^無料トライアル中/)
    assert.match(subscriptionStatusLabel(trial, 'pro', 'en') ?? '', /^Free trial/)
  })

  // 解約済みでも期限までは使える。ここを「更新」と出すと解約できていないと読まれる
  it('reports the remaining period once auto-renew is off', () => {
    const cancelled = proInfo({ expirationDate: '2026-10-01T09:00:00Z', periodType: 'NORMAL', willRenew: false })
    assert.match(subscriptionStatusLabel(cancelled, 'pro', 'ja') ?? '', /自動更新オフ/)
    assert.match(subscriptionStatusLabel(cancelled, 'pro', 'en') ?? '', /auto-renew off/)
  })

  it('treats an unknown willRenew as renewing', () => {
    const active = proInfo({ expirationDate: '2026-10-01T09:00:00Z' })
    assert.match(subscriptionStatusLabel(active, 'pro', 'ja') ?? '', /に更新$/)
  })

  // 権利側に期限が無いときだけ CustomerInfo 直下へ落ちる
  it('falls back to the account-wide latest expiration', () => {
    const info = { entitlements: { active: { pro: {} } }, latestExpirationDate: '2026-10-01T09:00:00Z' }
    assert.match(subscriptionStatusLabel(info, 'pro', 'ja') ?? '', /に更新$/)
  })
})
