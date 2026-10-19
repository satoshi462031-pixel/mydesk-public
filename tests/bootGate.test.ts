import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BOOT_DATA_TIMEOUT_MS, isBootReady, MIN_BRAND_SPLASH_MS } from '../src/utils/bootGate'

describe('boot gate', () => {
  it('shows Welcome without waiting for plans and gadgets', () => {
    assert.equal(isBootReady({
      themeReady: true,
      authLoading: false,
      onboarded: false,
      authSkipped: false,
      initialDataReady: false,
    }), true)
  })

  it('waits for cached data for returning users', () => {
    assert.equal(isBootReady({
      themeReady: true,
      authLoading: false,
      onboarded: true,
      authSkipped: true,
      initialDataReady: false,
    }), false)
    assert.equal(isBootReady({
      themeReady: true,
      authLoading: false,
      onboarded: true,
      authSkipped: true,
      initialDataReady: true,
    }), true)
  })

  it('never opens navigation while authentication or onboarding state is unresolved', () => {
    assert.equal(isBootReady({ themeReady: true, authLoading: true, onboarded: false, authSkipped: false, initialDataReady: true }), false)
    assert.equal(isBootReady({ themeReady: true, authLoading: false, onboarded: null, authSkipped: false, initialDataReady: true }), false)
    assert.equal(isBootReady({ themeReady: true, authLoading: false, onboarded: false, authSkipped: null, initialDataReady: true }), false)
  })

  it('waits for saved theme before showing onboarding or returning screens', () => {
    for (const onboarded of [false, true]) {
      assert.equal(isBootReady({ themeReady: false, authLoading: false, onboarded, authSkipped: true, initialDataReady: true }), false)
    }
  })

  it('keeps the startup budgets bounded', () => {
    assert.equal(MIN_BRAND_SPLASH_MS, 700)
    assert.ok(BOOT_DATA_TIMEOUT_MS <= 2500)
  })
})
