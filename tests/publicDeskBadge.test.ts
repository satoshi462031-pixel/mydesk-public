import assert from 'node:assert/strict'
import test from 'node:test'
import { publicDeskBadgeKind } from '../src/utils/publicDeskBadge'

const now = Date.parse('2026-09-20T00:00:00.000Z')
const desk = (created: string, updated = created) => ({
  id: 'desk-1',
  created_at: created,
  updated_at: updated,
  content_updated_at: updated,
})

test('公開から7日以内で一度も見ていないデスクは新着', () => {
  assert.equal(publicDeskBadgeKind(desk('2026-09-14T00:00:00.000Z'), {}, now), 'new')
})

test('一度も見ていなくても公開から7日を過ぎたデスクには印を出さない', () => {
  assert.equal(publicDeskBadgeKind(desk('2026-09-12T23:59:59.000Z'), {}, now), null)
})

test('見た後に内容が更新されたデスクは更新', () => {
  const item = desk('2026-08-01T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
  assert.equal(publicDeskBadgeKind(item, { 'desk-1': '2026-09-18T00:00:00.000Z' }, now), 'updated')
})

test('見た時点から内容が変わっていなければ印を出さない', () => {
  const item = desk('2026-08-01T00:00:00.000Z', '2026-09-19T00:00:00.000Z')
  assert.equal(publicDeskBadgeKind(item, { 'desk-1': '2026-09-19T00:00:00.000Z' }, now), null)
})
