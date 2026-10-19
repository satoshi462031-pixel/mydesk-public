import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { isSandboxEntitlement, parseSandboxAllowlist, proStateFrom, sandboxCounts } from '../supabase/functions/revenuecat-webhook/entitlement'
import { customerIdCandidates, matchCustomers, transferUsers } from '../supabase/functions/revenuecat-webhook/customers'

const now = Date.parse('2026-09-12T00:00:00Z')

describe('RevenueCat webhook: tier from the current entitlement', () => {
  it('is free when the customer has no pro entitlement', () => {
    assert.deepEqual(proStateFrom(undefined, now), { tier: 'free', expiresAt: null, productId: null })
  })

  it('is pro until the entitlement expires', () => {
    const state = proStateFrom({ expires_date: '2026-10-01T00:00:00Z', product_identifier: 'mydesk.pro.monthly' }, now)
    assert.equal(state.tier, 'pro')
    assert.equal(state.expiresAt, '2026-10-01T00:00:00.000Z')
    assert.equal(state.productId, 'mydesk.pro.monthly')
  })

  it('is free once the entitlement has expired', () => {
    assert.equal(proStateFrom({ expires_date: '2026-09-01T00:00:00Z' }, now).tier, 'free')
  })

  // 支払いの猶予期間中は BILLING_ISSUE と CANCELLATION が届くが、権利は続いている
  it('stays pro during the billing grace period', () => {
    const state = proStateFrom({
      expires_date: '2026-09-10T00:00:00Z',
      grace_period_expires_date: '2026-09-26T00:00:00Z',
    }, now)
    assert.equal(state.tier, 'pro')
    // is_pro_user の期限ガードには猶予の終わりを渡す
    assert.equal(state.expiresAt, '2026-09-26T00:00:00.000Z')
  })

  it('treats an entitlement without an expiration as lifetime', () => {
    assert.deepEqual(proStateFrom({ expires_date: null, product_identifier: 'promo' }, now), {
      tier: 'pro', expiresAt: null, productId: 'promo',
    })
  })

  it('does not grant access from an unreadable expiration', () => {
    assert.equal(proStateFrom({ expires_date: 'someday' }, now).tier, 'free')
  })
})

describe('RevenueCat webhook: Sandbox entitlements', () => {
  const entitlement = { expires_date: '2026-10-01T00:00:00Z', product_identifier: 'mydesk.pro.monthly' }

  it('detects a subscription bought in the sandbox', () => {
    assert.equal(isSandboxEntitlement({ subscriptions: { 'mydesk.pro.monthly': { is_sandbox: true } } }, entitlement), true)
    assert.equal(isSandboxEntitlement({ subscriptions: { 'mydesk.pro.monthly': { is_sandbox: false } } }, entitlement), false)
  })

  it('treats a lifetime purchase as sandbox only when every purchase was', () => {
    const lifetime = { expires_date: null, product_identifier: 'mydesk.pro.lifetime' }
    assert.equal(isSandboxEntitlement({ non_subscriptions: { 'mydesk.pro.lifetime': [{ is_sandbox: true }] } }, lifetime), true)
    assert.equal(isSandboxEntitlement({ non_subscriptions: { 'mydesk.pro.lifetime': [{ is_sandbox: true }, { is_sandbox: false }] } }, lifetime), false)
  })

  it('does not call an unknown origin sandbox', () => {
    assert.equal(isSandboxEntitlement({}, entitlement), false)
    assert.equal(isSandboxEntitlement(undefined, undefined), false)
  })

  // 許可リストがあればそれだけを見る。無ければ REVENUECAT_ALLOW_SANDBOX に従う
  it('lets the allowlist override the allow-all switch', () => {
    const list = parseSandboxAllowlist(' AAAA , bbbb ,,')
    assert.deepEqual([...list], ['aaaa', 'bbbb'])
    assert.equal(sandboxCounts('aaaa', false, list), true)
    assert.equal(sandboxCounts('cccc', true, list), false)
    assert.equal(sandboxCounts('cccc', true, new Set()), true)
    assert.equal(sandboxCounts('cccc', false, new Set()), false)
  })
})

describe('RevenueCat webhook: 顧客 ID と利用者の対応（107）', () => {
  const USER_A = 'aaaaaaaa-0000-4000-8000-000000000001'
  const USER_B = 'bbbbbbbb-0000-4000-8000-000000000002'
  const CUSTOMER_A = 'cccccccc-0000-4000-8000-00000000000a'
  const CUSTOMER_B = 'dddddddd-0000-4000-8000-00000000000b'
  const rows = [{ id: USER_A, rc_customer_id: CUSTOMER_A }, { id: USER_B, rc_customer_id: CUSTOMER_B }]

  it('利用者 ID のままの顧客（107 より前）は誰にも結び付けない', () => {
    const candidates = customerIdCandidates({ app_user_id: USER_A }, false)
    assert.deepEqual(matchCustomers(candidates, rows, false), [])
  })

  it('匿名 ID は飛ばし、エイリアスに張られた顧客 ID で引き当てる', () => {
    const candidates = customerIdCandidates({
      app_user_id: '$RCAnonymousID:abc',
      original_app_user_id: '$RCAnonymousID:abc',
      aliases: ['$RCAnonymousID:abc', CUSTOMER_A.toUpperCase()],
    }, false)
    assert.deepEqual(matchCustomers(candidates, rows, false), [{ userId: USER_A, customerId: CUSTOMER_A }])
  })

  it('TRANSFER 以外は最初に対応が取れた1人だけを動かす', () => {
    const candidates = customerIdCandidates({ app_user_id: CUSTOMER_B, aliases: [CUSTOMER_A] }, false)
    assert.deepEqual(matchCustomers(candidates, rows, false), [{ userId: USER_B, customerId: CUSTOMER_B }])
  })

  it('TRANSFER は移行元と移行先の両方を動かし、重複はまとめる', () => {
    const candidates = customerIdCandidates({ transferred_from: [CUSTOMER_A, CUSTOMER_A], transferred_to: [CUSTOMER_B, '$RCAnonymousID:x'] }, true)
    assert.deepEqual(matchCustomers(candidates, rows, true), [
      { userId: USER_A, customerId: CUSTOMER_A },
      { userId: USER_B, customerId: CUSTOMER_B },
    ])
  })

  // 購読を移したとき、AI の利用回数を移し先へ持ち越す相手（119）。分けられないと、
  // 購入の復元でアカウントの間を行き来させるだけで週の枠をアカウントの数だけ使えた
  it('TRANSFER の移行元と移行先を、利用者 ID に直して分ける', () => {
    assert.deepEqual(transferUsers({
      transferred_from: [CUSTOMER_A.toUpperCase(), CUSTOMER_A, '$RCAnonymousID:x'],
      transferred_to: [CUSTOMER_B],
    }, rows), { from: [USER_A], to: [USER_B] })
  })

  it('対応の無い顧客と、両側にいる同じ人は持ち越しの相手にしない', () => {
    const UNKNOWN = 'eeeeeeee-0000-4000-8000-00000000000e'
    assert.deepEqual(transferUsers({ transferred_from: [UNKNOWN], transferred_to: [CUSTOMER_B] }, rows), { from: [], to: [USER_B] })
    assert.deepEqual(transferUsers({ transferred_from: [CUSTOMER_A], transferred_to: [CUSTOMER_A, CUSTOMER_B] }, rows), { from: [], to: [USER_B] })
    assert.deepEqual(transferUsers({}, rows), { from: [], to: [] })
  })
})

describe('AI の利用回数を購読の移し替えで持ち越す（119）', () => {
  const sql = readFileSync('supabase/migrations/119_ai_usage_follows_transfer.sql', 'utf8')
  const webhook = readFileSync('supabase/functions/revenuecat-webhook/index.ts', 'utf8')

  it('移し先へは元の今週の回数・写真・トークンを足し、元は減らさない', () => {
    assert.match(sql, /msg_count\s+= t\.msg_count \+ v_from\.msg_count/)
    assert.match(sql, /photo_count = t\.photo_count \+ v_from\.photo_count/)
    assert.match(sql, /token_count = t\.token_count \+ v_from\.token_count/)
    assert.match(sql, /WHERE t\.user_id = p_to AND t\.period = v_period/)
    assert.doesNotMatch(sql, /WHERE t\.user_id = p_from/)
  })

  it('同じイベントの再送では二度足さない', () => {
    assert.match(sql, /PRIMARY KEY \(event_id, from_user, to_user\)/)
    assert.match(sql, /ON CONFLICT \(event_id, from_user, to_user\) DO NOTHING;\s+IF NOT FOUND THEN\s+RETURN 'duplicate'/)
  })

  it('利用者からは呼べず、Webhook だけが TRANSFER のときに呼ぶ', () => {
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.carry_ai_usage_on_transfer\(TEXT, UUID, UUID\) FROM PUBLIC, anon, authenticated/)
    assert.match(sql, /REVOKE ALL ON public\.ai_usage_transfers FROM PUBLIC, anon, authenticated/)
    assert.match(webhook, /if \(isTransfer\) \{\s+const \{ from, to \} = transferUsers\(event, customerRows \?\? \[\]\)/)
    assert.match(webhook, /rpc\('carry_ai_usage_on_transfer'/)
  })
})
