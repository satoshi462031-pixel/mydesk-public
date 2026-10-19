import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/053_account_backups.sql', 'utf8')

test('全ログインユーザーが自分のバックアップを作成できる', () => {
  const insertPolicy = migration.match(/CREATE POLICY "backups_insert"[\s\S]*?;/)?.[0]
  assert.ok(insertPolicy)
  assert.match(insertPolicy, /FOR INSERT WITH CHECK \(auth\.uid\(\) = user_id\)/)
  assert.doesNotMatch(insertPolicy, /is_pro_user/)
})

test('Freeは最新1件、Proは直近7件を保持する', () => {
  assert.match(migration, /CASE WHEN public\.is_pro_user\(NEW\.user_id\) THEN 7 ELSE 1 END/)
  assert.match(migration, /LIMIT keep_count/)
})
