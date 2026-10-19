import assert from 'node:assert/strict'
import test from 'node:test'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { clearSeenCache, hasUpdate, markSeen, syncSeen } from '../src/utils/bookmarkSeen'

test('一覧同期と既読更新が重なっても新しい既読日時を失わない', async (t) => {
  await clearSeenCache()

  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  const writes: string[] = []
  AsyncStorage.getItem = async () => JSON.stringify({
    desk: '2026-01-01T00:00:00.000Z',
    stale: '2026-01-01T00:00:00.000Z',
  })
  AsyncStorage.setItem = async (_key, value) => { writes.push(value) }
  t.after(async () => {
    await clearSeenCache()
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
  })

  await Promise.all([
    markSeen('desk', '2026-02-01T00:00:00.000Z'),
    syncSeen([{ deskId: 'desk', updatedAt: '2026-02-01T00:00:00.000Z' }]),
  ])

  assert.deepEqual(JSON.parse(writes.at(-1) ?? '{}'), {
    desk: '2026-02-01T00:00:00.000Z',
  })
})

test('古い一覧の既読記録で、詳細を読んだ新しい既読時刻を巻き戻さない', async (t) => {
  await clearSeenCache()
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  const writes: string[] = []
  AsyncStorage.getItem = async () => null
  AsyncStorage.setItem = async (_key, value) => { writes.push(value) }
  t.after(async () => {
    await clearSeenCache()
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
  })

  const latest = '2026-02-01T00:00:00.000Z'
  await Promise.all([
    markSeen('desk', latest),
    markSeen('desk', '2026-01-01T00:00:00.000Z'),
    markSeen('desk', ''),
    markSeen('desk', 'invalid'),
    markSeen('desk', '2026-02-01T09:00:00+09:00'),
  ])
  const seen = await syncSeen([{ deskId: 'desk', updatedAt: latest }])

  assert.equal(seen.desk, latest)
  assert.equal(hasUpdate(seen, 'desk', latest), false)
  assert.equal(hasUpdate(seen, 'desk', '2026-02-02T00:00:00.000Z'), true)
  assert.equal(writes.length, 1)
  assert.equal(JSON.parse(writes.at(-1) ?? '{}').desk, latest)
})
