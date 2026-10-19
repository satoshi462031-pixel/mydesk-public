import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeAnalyticsProperties } from '../src/utils/analyticsProperties'

test('PostHogへ自由入力と永続IDを送らない', () => {
  assert.deepEqual(
    sanitizeAnalyticsProperties({
      deskId: 'private-id',
      url: 'mydesk://auth/reset-password?code=secret',
      message: 'user input',
      email: 'desk@example.com',
      public_nickname: 'private name',
      category: 'Monitor',
      gadget_count: 3,
      error_name: 'AuthError',
    }),
    { category: 'Monitor', gadget_count: 3, error_name: 'AuthError' },
  )
})
