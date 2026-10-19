import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/083_desk_unlisted_visibility.sql', 'utf8')
// 「〜しないこと」の検査はコメントを外した実行される SQL に当てる（解説の文字列に当たらないように）
const sql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

test('visibility に unlisted を足す', () => {
  assert.match(sql, /CHECK \(visibility IN \('public', 'unlisted', 'private'\)\)/)
})

// RLS を広げると visibility=eq.unlisted で URL限定のデスクを全件列挙できる
test('RLS の SELECT ポリシーは広げない', () => {
  assert.doesNotMatch(sql, /CREATE POLICY/)
  assert.doesNotMatch(sql, /DROP POLICY/)
})

test('リンクから開く関数は ID 指定で、公開中と URL限定だけを返す', () => {
  for (const name of ['get_link_shared_desk', 'get_link_shared_desk_meta']) {
    const body = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(p_desk_id UUID\\)[\\s\\S]*?\\$\\$;`))?.[0]
    assert.ok(body, name)
    assert.match(body, /SECURITY DEFINER/)
    assert.match(body, /SET search_path = public/)
    assert.match(body, /WHERE d\.id = p_desk_id\s+AND d\.visibility IN \('public', 'unlisted'\)/)
  }
})

// URL限定もリンクが出回れば誰でも読めるので、公開中と同じ基準で文面を弾く
test('公開文面の検査は非公開だけを素通りさせる', () => {
  const body = sql.match(/FUNCTION public\.validate_public_desk_content\(\)[\s\S]*?\$\$;/)?.[0]
  assert.ok(body)
  assert.match(body, /IF NEW\.visibility = 'private' THEN\s+RETURN NEW;/)
  assert.doesNotMatch(body, /visibility <> 'public'/)
})

// いいね・保存の条件はこのマイグレーションで変えない（URL限定は見るだけ）
test('いいね・保存のポリシーには触れない', () => {
  assert.doesNotMatch(sql, /likes_insert_own|bookmarks_insert|gadget_bookmarks_insert_own/)
})
