import assert from 'node:assert/strict'
import test from 'node:test'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearSeenCache, syncSeen } from '../src/utils/bookmarkSeen'
import { isNewFollowedDesk, NEW_DESK_SEEN, unreadDeskUpdates, watchedSeenEntries } from '../src/utils/deskUpdateFeed'

const desk = (id: string, userId: string, stamp: string) => ({
  id,
  user_id: userId,
  updated_at: stamp,
  content_updated_at: null,
})

/** キーごとに値を持つ AsyncStorage の差し替え。既存テストの「全キー同じ値」では2つの記録を分けられない */
function mockStorage(t: test.TestContext, initial: Record<string, string>) {
  const store = new Map(Object.entries(initial))
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  AsyncStorage.getItem = async (key) => store.get(key) ?? null
  AsyncStorage.setItem = async (key, value) => { store.set(key, value) }
  t.after(async () => {
    await clearSeenCache()
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
  })
  return store
}

test('ownerId はフォロー中の人のデスクにだけ付く', () => {
  const entries = watchedSeenEntries(
    [desk('saved', 'stranger', '2026-01-01T00:00:00Z'), desk('followed', 'friend', '2026-01-02T00:00:00Z')],
    ['friend'],
  )
  assert.deepEqual(entries, [
    { deskId: 'saved', updatedAt: '2026-01-01T00:00:00Z' },
    { deskId: 'followed', updatedAt: '2026-01-02T00:00:00Z', ownerId: 'friend' },
  ])
})

test('フォローした直後に見えた既存のデスクは新しいデスクにしない', async (t) => {
  await clearSeenCache()
  mockStorage(t, {})
  const desks = [desk('existing', 'friend', '2026-03-01T00:00:00Z')]

  const seen = await syncSeen(watchedSeenEntries(desks, ['friend']), { followees: ['friend'] })

  assert.equal(seen.existing, '2026-03-01T00:00:00Z')
  assert.deepEqual(unreadDeskUpdates(desks, seen), [])
})

test('前回から追っていた人の記録に無いデスクは、新しく公開されたものとして並ぶ', async (t) => {
  await clearSeenCache()
  mockStorage(t, {
    '@bookmark_seen': JSON.stringify({ existing: '2026-03-01T00:00:00Z' }),
    '@followed_users_seen': JSON.stringify(['friend']),
  })
  const desks = [
    desk('existing', 'friend', '2026-03-01T00:00:00Z'),
    desk('fresh', 'friend', '2026-04-01T00:00:00Z'),
  ]

  const seen = await syncSeen(watchedSeenEntries(desks, ['friend']), { followees: ['friend'] })

  assert.equal(seen.fresh, NEW_DESK_SEEN)
  assert.ok(isNewFollowedDesk(seen, 'fresh'))
  assert.deepEqual(unreadDeskUpdates(desks, seen).map((d) => d.id), ['fresh'])
})

// 保存一覧はフォローぶんを持っていない。そこで記録を捨てると、次の同期で
// フォロー中の人の既存デスクが全部「新しいデスク」に化ける
test('prune: false の同期はフォロー中の人のデスクの記録を残す', async (t) => {
  await clearSeenCache()
  const store = mockStorage(t, {
    '@bookmark_seen': JSON.stringify({ followed: '2026-03-01T00:00:00Z' }),
    '@followed_users_seen': JSON.stringify(['friend']),
  })

  await syncSeen([{ deskId: 'saved', updatedAt: '2026-01-01T00:00:00Z' }], { prune: false })
  await clearSeenCache()
  const seen = await syncSeen(
    watchedSeenEntries([desk('followed', 'friend', '2026-03-01T00:00:00Z')], ['friend']),
    { followees: ['friend'] },
  )

  assert.equal(seen.followed, '2026-03-01T00:00:00Z')
  assert.deepEqual(JSON.parse(store.get('@followed_users_seen') ?? '[]'), ['friend'])
})
