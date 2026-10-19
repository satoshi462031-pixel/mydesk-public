import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasAIAccess, shouldShowAIPaywall } from '../src/utils/aiAccess'

describe('AI access gate', () => {
  it('blocks interaction while the server decision is loading', () => {
    assert.equal(hasAIAccess({ loaded: false, isPro: false, canUse: true }), false)
    assert.equal(shouldShowAIPaywall({ loaded: false, isPro: false, canUse: false }), false)
  })

  it('shows the paywall when Free has no remaining service allowance', () => {
    assert.equal(hasAIAccess({ loaded: true, isPro: false, canUse: false }), false)
    assert.equal(shouldShowAIPaywall({ loaded: true, isPro: false, canUse: false }), true)
  })

  it('allows a future server-granted Free allowance', () => {
    assert.equal(hasAIAccess({ loaded: true, isPro: false, canUse: true }), true)
    assert.equal(shouldShowAIPaywall({ loaded: true, isPro: false, canUse: true }), false)
  })

  it('keeps Pro entitled after its weekly allowance is exhausted', () => {
    assert.equal(hasAIAccess({ loaded: true, isPro: true, canUse: false }), true)
    assert.equal(shouldShowAIPaywall({ loaded: true, isPro: true, canUse: false }), false)
  })
})
