import assert from 'node:assert/strict'
import test from 'node:test'
import { formatListTimestamp, formatRelativeDay } from '../src/utils/dateFormat'

test('経過時間ではなくカレンダー日で今日と昨日を判定する', () => {
  const now = new Date(2026, 7, 29, 0, 5)
  assert.equal(formatRelativeDay(new Date(2026, 7, 28, 23, 55).toISOString(), 'ja', now), '昨日')
  assert.equal(formatRelativeDay(new Date(2026, 7, 29, 0, 1).toISOString(), 'en', now), 'Today')
})

test('未来日時と壊れた日時を安全に表示する', () => {
  const now = new Date(2026, 7, 29, 12)
  assert.equal(formatRelativeDay(new Date(2026, 7, 30, 12).toISOString(), 'ja', now), '今日')
  assert.equal(formatRelativeDay('invalid', 'ja', now), '')
})

test('一覧の時刻は、分・時間・日・週・か月・年の経過で出す', () => {
  const now = new Date(2026, 9, 15, 12, 0)
  const at = (...args: [number, number, number, number?, number?, number?]) => new Date(...args).toISOString()
  assert.equal(formatListTimestamp(at(2026, 9, 15, 11, 59, 40), 'ja', now), 'たった今')
  assert.equal(formatListTimestamp(at(2026, 9, 15, 11, 15), 'ja', now), '45分前')
  assert.equal(formatListTimestamp(at(2026, 9, 14, 21, 0), 'en', now), '15h ago')
  assert.equal(formatListTimestamp(at(2026, 9, 14, 9, 0), 'ja', now), '昨日')
  assert.equal(formatListTimestamp(at(2026, 9, 10, 9, 0), 'en', now), '5d ago')
  assert.equal(formatListTimestamp(at(2026, 9, 1, 9, 0), 'ja', now), '2週間前')
  assert.equal(formatListTimestamp(at(2026, 8, 16, 9, 0), 'en', now), '4w ago')
  assert.equal(formatListTimestamp(at(2026, 7, 15, 9, 0), 'ja', now), '2か月前')
  // 日がまだ来ていなければ、その月は数えない
  assert.equal(formatListTimestamp(at(2026, 7, 20, 9, 0), 'ja', now), '1か月前')
  assert.equal(formatListTimestamp(at(2025, 10, 1, 9, 0), 'en', now), '11mo ago')
  assert.equal(formatListTimestamp(at(2024, 2, 12, 9, 0), 'ja', now), '2年前')
})

test('一覧の時刻は、端末の時計が遅れて未来になった値と壊れた値を安全に出す', () => {
  const now = new Date(2026, 9, 15, 12, 0)
  assert.equal(formatListTimestamp(new Date(2026, 9, 15, 12, 3).toISOString(), 'ja', now), 'たった今')
  assert.equal(formatListTimestamp('invalid', 'ja', now), '')
})
