import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countClaps, decideClapPush } from '../supabase/functions/notify-claps/decide'

const now = Date.parse('2026-09-30T12:00:00Z')
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString()
const ROUND = '2026-09-29T08:00:00.123456+00:00'
const OLD_ROUND = '2026-09-01T08:00:00.654321+00:00'

describe('notify-claps: 数え方', () => {
  it('持ち主本人とブロック関係の人を除き、前の通知より後の拍手と今の版への拍手を数える', () => {
    const counts = countClaps([
      { user_id: 'a', created_at: hoursAgo(1), round_at: ROUND },
      { user_id: 'b', created_at: hoursAgo(30), round_at: ROUND },
      { user_id: 'c', created_at: hoursAgo(2), round_at: OLD_ROUND },
      { user_id: 'blocked', created_at: hoursAgo(1), round_at: ROUND },
      { user_id: 'owner', created_at: hoursAgo(1), round_at: ROUND },
    ], { ownerId: 'owner', blocked: new Set(['blocked']), roundAt: ROUND, lastSentAt: hoursAgo(20), now })
    assert.deepEqual(counts, { fresh: 2, round: 2 })
  })

  it('一度も送っていない人は24時間まで遡る（機能が入る前の拍手を新しいと言わない）', () => {
    const counts = countClaps([
      { user_id: 'a', created_at: hoursAgo(23), round_at: ROUND },
      { user_id: 'b', created_at: hoursAgo(25), round_at: ROUND },
    ], { ownerId: 'owner', blocked: new Set(), roundAt: ROUND, lastSentAt: null, now })
    assert.equal(counts.fresh, 1)
  })
})

describe('notify-claps: 送るかどうか', () => {
  it('最初の拍手はすぐ送る', () => {
    assert.deepEqual(decideClapPush({ enabled: true, fresh: 1, lastSentAt: null }, now), { send: true })
  })

  it('前の通知から12時間たっていなければ送らない', () => {
    assert.deepEqual(decideClapPush({ enabled: true, fresh: 3, lastSentAt: hoursAgo(11) }, now), { send: false, reason: 'throttled' })
    assert.deepEqual(decideClapPush({ enabled: true, fresh: 3, lastSentAt: hoursAgo(13) }, now), { send: true })
  })

  it('新しい拍手が無い・持ち主が切っているときは送らない', () => {
    assert.deepEqual(decideClapPush({ enabled: true, fresh: 0, lastSentAt: null }, now), { send: false, reason: 'no_new' })
    assert.deepEqual(decideClapPush({ enabled: false, fresh: 5, lastSentAt: null }, now), { send: false, reason: 'disabled' })
  })
})
