import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/084_user_follows.sql', 'utf8')
// 「〜しないこと」の検査はコメントを外した実行される SQL に当てる（解説の文字列に当たらないように）
const sql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

// 他人の行を読めると、RLS 越しに件数を数えるだけでフォロワー数を出せてしまう
test('フォローは本人しか読めない', () => {
  assert.match(sql, /ALTER TABLE public\.user_follows ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.user_follows FROM anon/)
  assert.match(sql, /user_follows_select_own[\s\S]*?USING \(auth\.uid\(\) = follower_id\)/)
  assert.doesNotMatch(sql, /followee_id\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*followee_id/)
})

test('書けるのは自分のフォローだけ', () => {
  assert.match(sql, /user_follows_insert_own[\s\S]*?WITH CHECK \(auth\.uid\(\) = follower_id\)/)
  assert.match(sql, /user_follows_delete_own[\s\S]*?USING \(auth\.uid\(\) = follower_id\)/)
  assert.doesNotMatch(sql, /FOR UPDATE/)
})

test('フォロワー数の集計は持たない', () => {
  assert.doesNotMatch(sql, /follower_count|followers_count|count\(/i)
})

// タグは 060 から本人が変えられる。キーにするとタグを変えただけでフォローが外れる
test('相手は user_id で持ち、自分自身はフォローできない', () => {
  assert.match(sql, /PRIMARY KEY \(follower_id, followee_id\)/)
  assert.match(sql, /CHECK \(follower_id <> followee_id\)/)
  assert.doesNotMatch(sql, /followee_tag/)
})

test('どちらかのアカウントが消えたら行も消える', () => {
  assert.match(sql, /follower_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
  assert.match(sql, /followee_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/)
})
