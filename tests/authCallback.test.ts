import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authCallbackCode, matchesAuthCallback } from '../src/utils/authCallback'

const expected = 'mydesk://auth/reset-password'
test('only the exact authentication return endpoint is accepted', () => {
  assert.equal(matchesAuthCallback(expected + '?code=abc', expected), true)
  for (const url of [
    'https://evil.invalid/auth/reset-password?code=abc',
    'mydesk://desk/other?next=auth/reset-password&code=abc',
    expected + '/extra?code=abc',
    'mydesk://auth/reset-password-fake?code=abc',
    expected + '?code=%C0',
    expected + '?code=' + 'x'.repeat(8192),
  ]) assert.equal(authCallbackCode(url, expected), null, url)
})
test('callback codes are decoded once and are not taken from token fragments', () => {
  assert.equal(authCallbackCode(expected + '?code=abc%2B123', expected), 'abc+123')
  assert.equal(authCallbackCode(expected + '#access_token=attacker&refresh_token=attacker', expected), null)
  assert.equal(authCallbackCode(expected + '#code=abc', expected), null)
  assert.equal(authCallbackCode(expected + '?code=abc%2525', expected), 'abc%25')
})
test('ambiguous or failed authentication responses cannot establish a session', () => {
  for (const query of ['code=a&code=b', 'code=a&%63ode=b', 'code=', 'code=a&error=denied', 'code=a&error_code=expired', 'code=%00bad', 'code=bad+code']) {
    assert.equal(authCallbackCode(expected + '?' + query, expected), null, query)
  }
})
test('Web OAuth responses must return to the generated origin and exact path', () => {
  const web = 'https://mydesk.page/auth/callback'
  assert.equal(authCallbackCode(web + '?code=abc', web), 'abc')
  assert.equal(authCallbackCode('https://mydesk.page.evil.invalid/auth/callback?code=abc', web), null)
  assert.equal(authCallbackCode('https://mydesk.page@evil.invalid/auth/callback?code=abc', web), null)
  assert.equal(authCallbackCode('http://mydesk.page/auth/callback?code=abc', web), null)
})
