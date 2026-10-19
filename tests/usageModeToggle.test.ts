import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStoredDate } from '../src/utils/dateFormat'
import { currentUsageMode, withCurrentUsageMode } from '../src/utils/usageModeToggle'

const TODAY = '2026-10-03'
const d = (key: string) => formatStoredDate(key, 'ja')

test('使っていた期間を書き換えず、今日で区切って飾りの期間を足す', () => {
  const drafts = [{ mode: 'active' as const, startedAt: d('2026-01-01'), endedAt: '' }]
  const next = withCurrentUsageMode(drafts, 'decor', 'ja', TODAY)
  assert.deepEqual(next.map((p) => [p.mode, p.startedAt, p.endedAt]), [
    ['active', d('2026-01-01'), d(TODAY)],
    ['decor', d(TODAY), ''],
  ])
  assert.equal(currentUsageMode(next), 'decor')
})

test('同じ編集の中で戻したら、区切った期間を繋ぎ直す', () => {
  const drafts = [{ mode: 'active' as const, startedAt: d('2026-01-01'), endedAt: '', originalEndedAt: '' }]
  const back = withCurrentUsageMode(withCurrentUsageMode(drafts, 'decor', 'ja', TODAY), 'active', 'ja', TODAY)
  assert.deepEqual(back, drafts)
})

test('今日以降に始まる期間・日付未入力の期間は向きだけ変える', () => {
  assert.deepEqual(
    withCurrentUsageMode([{ mode: 'active', startedAt: d(TODAY), endedAt: '' }], 'decor', 'ja', TODAY),
    [{ mode: 'decor', startedAt: d(TODAY), endedAt: '' }],
  )
  assert.deepEqual(
    withCurrentUsageMode([{ mode: 'active', startedAt: '', endedAt: '' }], 'decor', 'ja', TODAY),
    [{ mode: 'decor', startedAt: '', endedAt: '' }],
  )
})

test('このデスクから外した機材（今の期間が無い）は変えない', () => {
  const drafts = [{ mode: 'active' as const, startedAt: d('2026-01-01'), endedAt: d('2026-02-01') }]
  assert.equal(currentUsageMode(drafts), null)
  assert.deepEqual(withCurrentUsageMode(drafts, 'decor', 'ja', TODAY), drafts)
})
