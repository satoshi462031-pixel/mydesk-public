import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRecentlyAuthenticated, jwtPayload, lastAuthenticatedAt, MAX_REAUTH_AGE_SECONDS } from '../supabase/functions/delete-account/reauth'

function token(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`
}

const now = 1_800_000_000

describe('delete-account: 削除直前の再認証', () => {
  it('reads the payload of a JWT', () => {
    assert.deepEqual(jwtPayload(token({ sub: 'abc' })), { sub: 'abc' })
    assert.equal(jwtPayload('not-a-jwt'), null)
    assert.equal(jwtPayload('a.###.c'), null)
  })

  it('uses the latest amr timestamp, not iat', () => {
    const payload = jwtPayload(token({ iat: now, amr: [{ method: 'oauth', timestamp: now - 7200 }, { method: 'password', timestamp: now - 30 }] }))
    assert.equal(lastAuthenticatedAt(payload), now - 30)
  })

  // トークンを更新すると iat は進むが、ログインした時刻（amr）は残る
  it('rejects a refreshed token whose sign-in is old', () => {
    const payload = jwtPayload(token({ iat: now, amr: [{ method: 'password', timestamp: now - MAX_REAUTH_AGE_SECONDS - 1 }] }))
    assert.equal(isRecentlyAuthenticated(payload, now), false)
  })

  it('accepts a sign-in within the window', () => {
    const payload = jwtPayload(token({ amr: [{ method: 'oauth', timestamp: now - 60 }] }))
    assert.equal(isRecentlyAuthenticated(payload, now), true)
  })

  it('rejects tokens without amr or with timestamps far in the future', () => {
    assert.equal(isRecentlyAuthenticated(jwtPayload(token({ sub: 'x' })), now), false)
    assert.equal(isRecentlyAuthenticated(jwtPayload(token({ amr: [{ method: 'password', timestamp: now + 3600 }] })), now), false)
  })
})
