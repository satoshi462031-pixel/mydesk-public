import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildStoreReviewUrls, buildSupportEmailUrl, isStoreReviewEnabled } from '../src/utils/helpLinks'

describe('help links', () => {
  it('opens Google Play on Android', () => {
    assert.deepEqual(
      buildStoreReviewUrls('android', 'com.example.app', 'itms-apps://example', 'https://apps.apple.com/example'),
      {
        native: 'market://details?id=com.example.app',
        web: 'https://play.google.com/store/apps/details?id=com.example.app',
      },
    )
  })

  it('keeps App Store links on iOS', () => {
    assert.deepEqual(
      buildStoreReviewUrls('ios', 'com.example.app', 'itms-apps://example', 'https://apps.apple.com/example'),
      { native: 'itms-apps://example', web: 'https://apps.apple.com/example' },
    )
  })

  it('shows review links only after the current native store is public', () => {
    assert.equal(isStoreReviewEnabled('ios', true, false), true)
    assert.equal(isStoreReviewEnabled('ios', false, true), false)
    assert.equal(isStoreReviewEnabled('android', false, true), true)
    assert.equal(isStoreReviewEnabled('android', true, false), false)
    assert.equal(isStoreReviewEnabled('web', true, true), false)
  })

  it('encodes the localized support email subject', () => {
    assert.equal(
      buildSupportEmailUrl('support@example.com', 'ja'),
      'mailto:support@example.com?subject=MyDesk%20%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B',
    )
  })
})
