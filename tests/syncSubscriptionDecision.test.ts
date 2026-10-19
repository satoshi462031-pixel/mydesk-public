import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { syncDecision } from '../supabase/functions/sync-subscription/decide'

const pro = { tier: 'pro' as const, expiresAt: '2026-11-11T00:00:00.000Z', productId: 'mydesk.pro.monthly' }
const free = { tier: 'free' as const, expiresAt: null, productId: null }

describe('sync-subscription: whether to rewrite the stored tier', () => {
  it('grants Pro restored without a webhook (no subscription row yet)', () => {
    assert.equal(syncDecision({ subscription: null, profileTier: 'free' }, pro), 'apply')
  })

  it('does not overwrite a hand-granted Pro for someone RevenueCat has never managed', () => {
    assert.equal(syncDecision({ subscription: null, profileTier: 'pro' }, free), 'unmanaged')
  })

  it('moves the expiry forward when a RENEWAL webhook was missed', () => {
    const stored = { subscription: { tier: 'pro', expires_at: '2026-10-11T00:00:00+00:00' }, profileTier: 'pro' }
    assert.equal(syncDecision(stored, pro), 'apply')
  })

  it('leaves the row alone when it already matches (same instant, different notation)', () => {
    const stored = { subscription: { tier: 'pro', expires_at: '2026-11-11T09:00:00+09:00' }, profileTier: 'pro' }
    assert.equal(syncDecision(stored, pro), 'unchanged')
  })

  it('repairs a profile tier that disagrees with the subscription row', () => {
    const stored = { subscription: { tier: 'pro', expires_at: pro.expiresAt }, profileTier: 'free' }
    assert.equal(syncDecision(stored, pro), 'apply')
  })

  it('drops Pro that RevenueCat no longer grants (missed EXPIRATION or refund)', () => {
    const stored = { subscription: { tier: 'pro', expires_at: '2026-10-01T00:00:00Z' }, profileTier: 'pro' }
    assert.equal(syncDecision(stored, free), 'apply')
  })

  it('treats a lifetime entitlement (no expiry) as matching only another lifetime one', () => {
    const lifetime = { tier: 'pro' as const, expiresAt: null, productId: 'mydesk.pro.lifetime' }
    assert.equal(syncDecision({ subscription: { tier: 'pro', expires_at: null }, profileTier: 'pro' }, lifetime), 'unchanged')
    assert.equal(syncDecision({ subscription: { tier: 'pro', expires_at: null }, profileTier: 'pro' }, pro), 'apply')
  })
})
