import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupHistoryByDay, historyPeriodLabel } from '../src/utils/historyPeriod'

// 2026-10-04（日曜日）の昼。端末の暦日で数えるので、ローカル時刻で組み立てる
const now = new Date(2026, 9, 4, 12, 0)
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString()

describe('history period labels', () => {
  it('reads today and yesterday by name, then weekdays within a week', () => {
    assert.equal(historyPeriodLabel(at(2026, 10, 4, 0), 'ja', now), '今日')
    assert.equal(historyPeriodLabel(at(2026, 10, 3, 23), 'ja', now), '昨日')
    assert.equal(historyPeriodLabel(at(2026, 9, 28), 'ja', now), '月曜日')
    assert.equal(historyPeriodLabel(at(2026, 9, 28), 'en', now), 'Monday')
  })

  it('switches to dates after a week and adds the year only when it differs', () => {
    assert.equal(historyPeriodLabel(at(2026, 9, 27), 'ja', now), '9月27日')
    assert.equal(historyPeriodLabel(at(2026, 9, 27), 'en', now), 'Sep 27')
    assert.equal(historyPeriodLabel(at(2025, 12, 31), 'ja', now), '2025年12月31日')
    assert.equal(historyPeriodLabel(at(2025, 12, 31), 'en', now), 'Dec 31, 2025')
  })

  it('treats a time ahead of the device clock as today', () => {
    assert.equal(historyPeriodLabel(at(2026, 10, 5), 'ja', now), '今日')
  })

  it('returns an empty label for an invalid time', () => {
    assert.equal(historyPeriodLabel('not a date', 'ja', now), '')
  })
})

describe('grouping history by day', () => {
  it('keeps the newest-first order and starts a group at each new day', () => {
    const items = [
      { id: 'a', at: at(2026, 10, 4, 11) },
      { id: 'b', at: at(2026, 10, 4, 8) },
      { id: 'c', at: at(2026, 10, 2) },
      { id: 'd', at: at(2026, 9, 1) },
    ]
    const groups = groupHistoryByDay(items, (item) => item.at, 'ja', now)
    assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
      ['今日', ['a', 'b']],
      ['金曜日', ['c']],
      ['9月1日', ['d']],
    ])
  })
})
