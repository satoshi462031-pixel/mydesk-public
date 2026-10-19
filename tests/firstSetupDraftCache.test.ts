import assert from 'node:assert/strict'
import test from 'node:test'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  clearFirstSetupDraft,
  clearFirstSetupDraftCache,
  loadFirstSetupDraft,
  peekFirstSetupDraft,
  saveFirstSetupDraft,
} from '../src/store/firstSetupStore'

const OLD = { screen: 'DeskPlacement', planId: 'old', createdAt: '2026-09-01T00:00:00.000Z' } as const
const NEW = { screen: 'PhotoFill', planId: 'new', createdAt: '2026-09-02T00:00:00.000Z' } as const

function mockStorage(t: test.TestContext, getItem: () => Promise<string | null>) {
  const originalGetItem = AsyncStorage.getItem
  const originalSetItem = AsyncStorage.setItem
  const originalRemoveItem = AsyncStorage.removeItem
  AsyncStorage.getItem = getItem
  AsyncStorage.setItem = async () => {}
  AsyncStorage.removeItem = async () => {}
  t.after(() => {
    AsyncStorage.getItem = originalGetItem
    AsyncStorage.setItem = originalSetItem
    AsyncStorage.removeItem = originalRemoveItem
    clearFirstSetupDraftCache()
  })
}

// 一覧はフォーカスのたびに読み直す。読み終わるまで待つと、作成を続けるデスクを開いてすぐ閉じたとき
// 「作成途中」の行が一瞬消えていた
test('保存・破棄した再開位置は、読み込みを待たずに引ける', async (t) => {
  mockStorage(t, async () => JSON.stringify(OLD))
  clearFirstSetupDraftCache()
  assert.equal(peekFirstSetupDraft(), undefined)

  const saving = saveFirstSetupDraft(NEW)
  await saving
  assert.deepEqual(peekFirstSetupDraft(), NEW)
  assert.deepEqual(await loadFirstSetupDraft(), NEW)

  await clearFirstSetupDraft()
  assert.equal(peekFirstSetupDraft(), null)
  assert.equal(await loadFirstSetupDraft(), null)
})

test('読んでいる間に保存されたら、読み終えた古い値で上書きしない', async (t) => {
  let resolveRead!: (value: string | null) => void
  const read = new Promise<string | null>((resolve) => { resolveRead = resolve })
  mockStorage(t, () => read)
  clearFirstSetupDraftCache()

  const loading = loadFirstSetupDraft()
  const saving = saveFirstSetupDraft(NEW)
  resolveRead(JSON.stringify(OLD))
  await saving

  assert.deepEqual(await loading, NEW)
  assert.deepEqual(peekFirstSetupDraft(), NEW)
})

test('ログアウトで控えを捨てたら、ディスクから読み直す', async (t) => {
  mockStorage(t, async () => null)
  await saveFirstSetupDraft(NEW)
  clearFirstSetupDraftCache()
  assert.equal(peekFirstSetupDraft(), undefined)
  assert.equal(await loadFirstSetupDraft(), null)
})

test('最初の読み込みが遅れても、再起動後は最後に保存した段から再開する', async (t) => {
  let resolveRead!: (value: string | null) => void
  const read = new Promise<string | null>((resolve) => { resolveRead = resolve })
  mockStorage(t, () => read)
  let stored: string | null = null
  AsyncStorage.setItem = async (_key, value) => { stored = value }
  clearFirstSetupDraftCache()

  const first = saveFirstSetupDraft(OLD)
  const last = saveFirstSetupDraft(NEW)
  resolveRead(null)
  await Promise.all([first, last])
  clearFirstSetupDraftCache()
  AsyncStorage.getItem = async () => stored
  assert.deepEqual(await loadFirstSetupDraft(), NEW)
})

test('保存待ちの間に破棄した下書きはディスクにも復活しない', async (t) => {
  let resolveRead!: (value: string | null) => void
  const read = new Promise<string | null>((resolve) => { resolveRead = resolve })
  mockStorage(t, () => read)
  let stored: string | null = null
  AsyncStorage.setItem = async (_key, value) => { stored = value }
  AsyncStorage.removeItem = async () => { stored = null }
  clearFirstSetupDraftCache()

  const saving = saveFirstSetupDraft(NEW)
  const clearing = clearFirstSetupDraft()
  resolveRead(null)
  await Promise.all([saving, clearing])
  assert.equal(stored, null)
})

test('ログアウトで控えをリセットした後は、読み込み中だった前の人の下書きを戻さない', async (t) => {
  let resolveRead!: (value: string | null) => void
  const read = new Promise<string | null>((resolve) => { resolveRead = resolve })
  mockStorage(t, () => read)
  clearFirstSetupDraftCache()

  const loading = loadFirstSetupDraft()
  clearFirstSetupDraftCache()
  resolveRead(JSON.stringify(OLD))
  assert.equal(await loading, null)
  assert.equal(peekFirstSetupDraft(), undefined)
})

test('続けて段を保存しても、最初の作成日時を引き継ぐ', async (t) => {
  mockStorage(t, async () => stored)
  let stored: string | null = JSON.stringify(OLD)
  AsyncStorage.setItem = async (_key, value) => { stored = value }
  clearFirstSetupDraftCache()

  await Promise.all([
    saveFirstSetupDraft({ screen: 'DeskPlacement', planId: 'old' }),
    saveFirstSetupDraft({ screen: 'PhotoFill', planId: 'old' }),
  ])
  assert.deepEqual(JSON.parse(stored!), {
    screen: 'PhotoFill', planId: 'old', createdAt: OLD.createdAt,
  })
})

test('キャッシュのリセットは実行中の書き込み完了を待ってからディスク消去へ進める', async (t) => {
  mockStorage(t, async () => JSON.stringify(OLD))
  let resolveWrite!: () => void
  const writing = new Promise<void>((resolve) => { resolveWrite = resolve })
  let enteredWrite!: () => void
  const entered = new Promise<void>((resolve) => { enteredWrite = resolve })
  let stored: string | null = null
  AsyncStorage.setItem = async (_key, value) => {
    enteredWrite()
    await writing
    stored = value
  }
  clearFirstSetupDraftCache()

  const saving = saveFirstSetupDraft(NEW)
  await entered
  const clearing = clearFirstSetupDraftCache().then(() => { stored = null })
  resolveWrite()
  await Promise.all([saving, clearing])
  assert.equal(stored, null)
  assert.equal(peekFirstSetupDraft(), undefined)
})
