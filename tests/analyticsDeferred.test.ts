import assert from 'node:assert/strict'
import test from 'node:test'
import { deferredAnalyticsAction } from '../src/utils/analyticsDeferred'

test('同意前の初回イベントは送信済みにせず保留する', () => {
  assert.equal(deferredAnalyticsAction(false, false), 'defer')
})

test('同意後の未送信イベントだけを送る', () => {
  assert.equal(deferredAnalyticsAction(true, false), 'send')
  assert.equal(deferredAnalyticsAction(true, true), 'ignore')
  assert.equal(deferredAnalyticsAction(false, true), 'ignore')
})
