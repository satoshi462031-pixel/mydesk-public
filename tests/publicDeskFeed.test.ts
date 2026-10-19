import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterPublicDiscoveryRows,
  loadVisiblePublicDeskPage,
  normalizePublicDeskSearch,
  parsePublicDeskCursor,
  publicDeskCursorOf,
  publicDeskUpdateBadge,
  PUBLIC_DESK_SEARCH_MAX_LENGTH,
} from '../src/utils/publicDeskFeed'

type Row = { id: string; user_id: string; updated_at: string }

test('入口が違っても自分とブロック対象を公開ディスカバリーから除外する', () => {
  const rows: Row[] = [
    { id: 'self', user_id: 'me', updated_at: '2026-08-03' },
    { id: 'blocked', user_id: 'blocked-user', updated_at: '2026-08-02' },
    { id: 'visible', user_id: 'other-user', updated_at: '2026-08-01' },
  ]

  assert.deepEqual(
    filterPublicDiscoveryRows(rows, 'me', new Set(['blocked-user'])).map((row) => row.id),
    ['visible'],
  )
})

test('自分とブロック対象だけのページを越えて公開デスクを取得する', async () => {
  const pages: Record<string, Row[]> = {
    first: [
      { id: 'self', user_id: 'me', updated_at: '2026-08-03' },
      { id: 'blocked', user_id: 'blocked-user', updated_at: '2026-08-02' },
    ],
    '2026-08-02|blocked': [
      { id: 'visible', user_id: 'other-user', updated_at: '2026-08-01' },
    ],
  }

  const result = await loadVisiblePublicDeskPage({
    pageSize: 2,
    userId: 'me',
    blockedIds: new Set(['blocked-user']),
    loadPage: async (before) => pages[before ?? 'first'] ?? [],
  })

  assert.deepEqual(result.visible.map((row) => row.id), ['visible'])
  assert.equal(result.end, true)
  assert.equal(result.nextBefore, '2026-08-01|visible')
})

test('次ページの基準には表示行ではなく取得した最終行を使う', async () => {
  const rows: Row[] = [
    { id: 'visible', user_id: 'other-user', updated_at: '2026-08-03' },
    { id: 'blocked', user_id: 'blocked-user', updated_at: '2026-08-02' },
  ]

  const result = await loadVisiblePublicDeskPage({
    pageSize: 2,
    userId: 'me',
    blockedIds: new Set(['blocked-user']),
    loadPage: async () => rows,
  })

  assert.deepEqual(result.visible.map((row) => row.id), ['visible'])
  assert.equal(result.end, false)
  assert.equal(result.nextBefore, '2026-08-02|blocked')
})

// 日時だけを位置にすると、境目に同じ日時のデスクが並んだとき2ページ目で残りが飛ぶ
test('続きの位置に並びの2番目の鍵（id）まで入れる', () => {
  const cursor = publicDeskCursorOf({ id: 'b2c3', updated_at: '2026-08-02T10:00:00.123+00:00' })
  assert.deepEqual(parsePublicDeskCursor(cursor), { updatedAt: '2026-08-02T10:00:00.123+00:00', id: 'b2c3' })
  // 以前の形（日時だけ）もそのまま読める
  assert.deepEqual(parsePublicDeskCursor('2026-08-02T10:00:00Z'), { updatedAt: '2026-08-02T10:00:00Z' })
})

test('公開デスク検索語の空白と長さを正規化する', () => {
  assert.equal(normalizePublicDeskSearch('  白い　デスク  '), '白い デスク')
  assert.equal(normalizePublicDeskSearch(' ＦＸ　ＤＴＭ '), 'FX DTM')
  assert.equal(normalizePublicDeskSearch('   '), '')
  assert.equal(normalizePublicDeskSearch('a'.repeat(200)).length, PUBLIC_DESK_SEARCH_MAX_LENGTH)
})

// ─── カードの更新マーク ─────────────────────────────────────────
const NOW = new Date('2026-09-06T12:00:00Z')

test('機材が最近変わったカードには更新マークを出す', () => {
  assert.equal(publicDeskUpdateBadge({ content_updated_at: '2026-09-03T00:00:00Z' }, 'ja', NOW), '機材更新 3日前')
})

test('機材の更新が古ければマークを出さない', () => {
  assert.equal(publicDeskUpdateBadge({ content_updated_at: '2026-06-01T00:00:00Z' }, 'ja', NOW), null)
})

test('一度も機材が変わっていなければマークを出さない', () => {
  assert.equal(publicDeskUpdateBadge({ content_updated_at: null }, 'en', NOW), null)
  assert.equal(publicDeskUpdateBadge({}, 'en', NOW), null)
})
