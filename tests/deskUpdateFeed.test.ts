import assert from 'node:assert/strict'
import test from 'node:test'
import { hasUnreadBell, splitDeskUpdates, unreadDeskUpdates } from '../src/utils/deskUpdateFeed'

const desk = (id: string, stamp: string, content?: string | null) => ({
  id,
  updated_at: stamp,
  content_updated_at: content === undefined ? null : content,
})

test('既読より後に中身が変わったものだけを新しい順に返す', () => {
  const desks = [
    desk('old', '2026-01-01T00:00:00Z'),
    desk('new', '2026-03-01T00:00:00Z'),
    desk('newer', '2026-04-01T00:00:00Z'),
  ]
  const seen = {
    old: '2026-01-01T00:00:00Z',
    new: '2026-02-01T00:00:00Z',
    newer: '2026-02-01T00:00:00Z',
  }
  assert.deepEqual(unreadDeskUpdates(desks, seen).map((d) => d.id), ['newer', 'new'])
})

test('既読の記録が無いデスクは出さない（保存した直後に全件が並ばない）', () => {
  assert.deepEqual(unreadDeskUpdates([desk('fresh', '2026-03-01T00:00:00Z')], {}), [])
})

test('比較は content_updated_at を優先する（タイトルの直しでは出さない）', () => {
  // updated_at だけが進んだ＝タイトルの直しや再公開。中身は変わっていない
  const renamed = desk('renamed', '2026-03-01T00:00:00Z', '2026-01-01T00:00:00Z')
  assert.deepEqual(unreadDeskUpdates([renamed], { renamed: '2026-02-01T00:00:00Z' }), [])

  const changed = desk('changed', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
  assert.deepEqual(
    unreadDeskUpdates([changed], { changed: '2026-02-01T00:00:00Z' }).map((d) => d.id),
    ['changed'],
  )
})

test('ベルの点は未読があっても、その更新より後に一覧を開いていれば出さない', () => {
  const unread = [desk('a', '2026-03-01T00:00:00Z')]
  assert.equal(hasUnreadBell(unread, null), true)
  assert.equal(hasUnreadBell(unread, '2026-02-01T00:00:00Z'), true)
  assert.equal(hasUnreadBell(unread, '2026-03-02T00:00:00Z'), false)
  assert.equal(hasUnreadBell([], '2026-01-01T00:00:00Z'), false)
})

test('壊れた既読日時では点を出す（黙って消さない）', () => {
  assert.equal(hasUnreadBell([desk('a', '2026-03-01T00:00:00Z')], 'not-a-date'), true)
})

test('更新一覧は「新しく公開」と「更新」に分かれ、新しく公開が先に来る', () => {
  const entries = [
    { id: 'a', isNew: false },
    { id: 'b', isNew: true },
    { id: 'c', isNew: false },
  ]
  const { fresh, changed } = splitDeskUpdates(entries)
  assert.deepEqual(fresh.map((e) => e.id), ['b'])
  assert.deepEqual(changed.map((e) => e.id), ['a', 'c'])
})
