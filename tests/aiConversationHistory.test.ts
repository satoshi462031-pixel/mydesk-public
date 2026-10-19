import assert from 'node:assert/strict'
import test from 'node:test'
import { sortConversationsByRecent, type StoredConversation } from '../src/store/conversationStore'

function conversation(id: string, updatedAt: string): StoredConversation {
  return {
    id,
    title: id,
    messages: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  }
}

test('AI相談履歴を最終更新日時の新しい順に並べる', () => {
  const older = conversation('older', '2026-01-01T00:00:00.000Z')
  const newer = conversation('newer', '2026-02-01T00:00:00.000Z')

  assert.deepEqual(sortConversationsByRecent([older, newer]).map(item => item.id), ['newer', 'older'])
})

test('同じ更新日時のAI相談履歴は元の順序を維持する', () => {
  const timestamp = '2026-02-01T00:00:00.000Z'
  const first = conversation('first', timestamp)
  const second = conversation('second', timestamp)

  assert.deepEqual(sortConversationsByRecent([first, second]).map(item => item.id), ['first', 'second'])
})
