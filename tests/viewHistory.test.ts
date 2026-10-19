import assert from 'node:assert/strict'
import test from 'node:test'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { addToViewHistory, isViewHistoryEntry, loadViewHistory, mergeViewHistory, recordDeskView, removeFromViewHistory, VIEW_HISTORY_LIMIT, VIEW_HISTORY_STORAGE_LIMIT } from '../src/utils/viewHistory'
import { localUserDataKeys } from '../src/utils/localUserDataKeys'

test('見たデスクは先頭に入り、前に見ていたぶんは1件にまとまる', () => {
  const history = [
    { deskId: 'a', viewedAt: '2026-09-01T00:00:00.000Z' },
    { deskId: 'b', viewedAt: '2026-08-31T00:00:00.000Z' },
  ]
  assert.deepEqual(addToViewHistory(history, 'b', '2026-09-02T00:00:00.000Z'), [
    { deskId: 'b', viewedAt: '2026-09-02T00:00:00.000Z' },
    { deskId: 'a', viewedAt: '2026-09-01T00:00:00.000Z' },
  ])
})

test('上限を超えたら古いものから落とす', () => {
  const history = [
    { deskId: 'a', viewedAt: '2026-09-02T00:00:00.000Z' },
    { deskId: 'b', viewedAt: '2026-09-01T00:00:00.000Z' },
  ]
  assert.deepEqual(addToViewHistory(history, 'c', '2026-09-03T00:00:00.000Z', 2).map((entry) => entry.deskId), ['c', 'a'])
})

test('閲覧履歴の統合は入力を変更せず、時刻順・重複なし・最大1,000件を保持する', () => {
  const account = Array.from({ length: 1005 }, (_, index) => ({ deskId: String(index), viewedAt: new Date(Date.UTC(2020, 0, index + 1)).toISOString() }))
  const local = [{ deskId: '0', viewedAt: '2026-10-19T00:00:00Z' }]
  const original = JSON.stringify({ account, local })
  const merged = mergeViewHistory(account, local)
  assert.equal(merged.length, VIEW_HISTORY_STORAGE_LIMIT)
  assert.equal(merged[0].deskId, '0')
  assert.equal(new Set(merged.map(entry => entry.deskId)).size, VIEW_HISTORY_STORAGE_LIMIT)
  assert.equal(JSON.stringify({ account, local }), original)
})

test('無料100件／Pro 1,000件で記録し、解約後も保有済みの履歴を一度に失わない', async (t) => {
  let stored: string | null = null
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  AsyncStorage.getItem = async () => stored
  AsyncStorage.setItem = async (_key, value) => { stored = value }
  t.after(() => { AsyncStorage.getItem = originalGetItem; AsyncStorage.setItem = originalSetItem })
  for (let i = 0; i < 105; i++) await recordDeskView(`free-${i}`)
  assert.equal((await loadViewHistory()).length, VIEW_HISTORY_LIMIT)
  assert.equal((await loadViewHistory()).at(-1)?.deskId, 'free-5')
  for (let i = 0; i < 1005; i++) await recordDeskView(`pro-${i}`, undefined, VIEW_HISTORY_STORAGE_LIMIT)
  assert.equal((await loadViewHistory()).length, 1000)
  await recordDeskView('after-downgrade')
  assert.equal((await loadViewHistory()).length, 1000)
  assert.equal((await loadViewHistory())[0].deskId, 'after-downgrade')
  assert.equal((await loadViewHistory()).at(-1)?.deskId, 'pro-6')
})

test('閲覧履歴の検証は空のIDと無効な日時を拒否する', () => {
  for (const entry of [null, [], {}, { deskId: '', viewedAt: '2026-10-19' }, { deskId: 'a', viewedAt: 'broken' }, { deskId: 'a', viewedAt: 1 }]) {
    assert.equal(isViewHistoryEntry(entry), false)
  }
  assert.equal(isViewHistoryEntry({ deskId: 'a', viewedAt: '2026-10-19T00:00:00Z' }), true)
})

// 似たデスクから続けて開くと記録が立て続けに走る。読んで書く間に割り込まれると先の1件が消える
test('続けて記録しても取りこぼさない', async (t) => {
  let stored: string | null = null
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  AsyncStorage.getItem = async () => stored
  AsyncStorage.setItem = async (_key, value) => { stored = value }
  t.after(() => {
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
  })

  await Promise.all([
    recordDeskView('a', '2026-09-01T00:00:00.000Z'),
    recordDeskView('b', '2026-09-01T00:00:01.000Z'),
    recordDeskView('c', '2026-09-01T00:00:02.000Z'),
  ])
  assert.deepEqual((await loadViewHistory()).map((entry) => entry.deskId), ['c', 'b', 'a'])
})

// 読めなかったのを空として扱うと、一覧は0件と言い、次の記録は1件だけを書いて全履歴を消していた
test('読み込みに失敗したら、0件にせず失敗として返し、記録で上書きしない', async (t) => {
  let stored: string | null = JSON.stringify([{ deskId: 'a', viewedAt: '2026-09-01T00:00:00.000Z' }])
  let failing = true
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  AsyncStorage.getItem = async () => {
    if (failing) throw new Error('storage unavailable')
    return stored
  }
  AsyncStorage.setItem = async (_key, value) => { stored = value }
  t.after(() => {
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
  })

  await assert.rejects(loadViewHistory())
  await recordDeskView('b', '2026-09-02T00:00:00.000Z')
  failing = false
  assert.deepEqual((await loadViewHistory()).map((entry) => entry.deskId), ['a'])
})

test('× で消した直後の読み込みは、消したあとの履歴を返す', async (t) => {
  let stored: string | null = JSON.stringify([
    { deskId: 'a', viewedAt: '2026-09-02T00:00:00.000Z' },
    { deskId: 'b', viewedAt: '2026-09-01T00:00:00.000Z' },
  ])
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  AsyncStorage.getItem = async () => stored
  AsyncStorage.setItem = async (_key, value) => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    stored = value
  }
  t.after(() => {
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
  })

  void removeFromViewHistory('a')
  assert.deepEqual((await loadViewHistory()).map((entry) => entry.deskId), ['b'])
})

test('ログアウトで次のアカウントへ履歴を残さない', () => {
  assert.deepEqual(localUserDataKeys(['@desk_view_history_v1', 'app_theme']), ['@desk_view_history_v1'])
})
