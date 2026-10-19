import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decidePush } from '../supabase/functions/notify-followers/decide'

const now = Date.parse('2026-09-20T12:00:00Z')
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString()

describe('notify-followers: whether to push', () => {
  it('announces a desk that was just published for the first time', () => {
    assert.deepEqual(
      decidePush({ created_at: hoursAgo(0.01), content_updated_at: null }, null, now),
      { send: true, kind: 'new', stamp: hoursAgo(0.01) },
    )
  })

  it('does not call an old, never-changed desk new when it is re-published', () => {
    assert.deepEqual(
      decidePush({ created_at: hoursAgo(24 * 30), content_updated_at: null }, null, now),
      { send: false, reason: 'stale' },
    )
  })

  it('does not announce the first publish twice', () => {
    const created = hoursAgo(13)
    assert.deepEqual(
      decidePush({ created_at: created, content_updated_at: null }, { last_stamp: created, last_sent_at: hoursAgo(13) }, now),
      { send: false, reason: 'no_change' },
    )
  })

  it('announces a gear or photo change made after the last push', () => {
    assert.deepEqual(
      decidePush(
        { created_at: hoursAgo(24 * 30), content_updated_at: hoursAgo(0.01) },
        { last_stamp: hoursAgo(24 * 30), last_sent_at: hoursAgo(24 * 30) },
        now,
      ),
      { send: true, kind: 'updated', stamp: hoursAgo(0.01) },
    )
  })

  it('does not report a change made before this feature existed (no log yet)', () => {
    assert.deepEqual(
      decidePush({ created_at: hoursAgo(24 * 60), content_updated_at: hoursAgo(24 * 10) }, null, now),
      { send: false, reason: 'stale' },
    )
  })

  it('stays quiet when the desk is re-published without changes', () => {
    const changed = hoursAgo(2)
    assert.deepEqual(
      decidePush({ created_at: hoursAgo(100), content_updated_at: changed }, { last_stamp: changed, last_sent_at: changed }, now),
      { send: false, reason: 'no_change' },
    )
  })

  it('holds back a second change within 12 hours of the last push', () => {
    assert.deepEqual(
      decidePush(
        { created_at: hoursAgo(100), content_updated_at: hoursAgo(0.01) },
        { last_stamp: hoursAgo(3), last_sent_at: hoursAgo(3) },
        now,
      ),
      { send: false, reason: 'throttled' },
    )
  })
})
