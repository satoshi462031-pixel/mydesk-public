import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/054_likes.sql', 'utf8')

test('いいねしたユーザーのIDは本人以外に公開しない', () => {
  const selectPolicy = migration.match(/CREATE POLICY "likes_select_own"[\s\S]*?;/)?.[0]
  assert.ok(selectPolicy)
  assert.match(selectPolicy, /auth\.uid\(\) = user_id/)
  assert.match(migration, /REVOKE ALL ON public\.likes FROM anon/)
})

test('非公開デスクと自分のデスクにはいいねできない', () => {
  const insertPolicy = migration.match(/CREATE POLICY "likes_insert_own"[\s\S]*?\n {2}\);/)?.[0]
  assert.ok(insertPolicy)
  assert.match(insertPolicy, /visibility = 'public'/)
  assert.match(insertPolicy, /user_id <> auth\.uid\(\)/)
})

test('いいね数だけではデスクの更新日時を進めない', () => {
  assert.match(migration, /to_jsonb\(NEW\) - 'updated_at' - 'like_count'/)
  assert.match(migration, /NEW\.updated_at := OLD\.updated_at/)
})
