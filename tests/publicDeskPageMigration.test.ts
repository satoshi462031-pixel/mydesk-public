import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync('supabase/migrations/097_public_desk_page_status.sql', 'utf8')

test('削除記録は本文を保存せず、直接閲覧とアカウント削除後の保持を許さない', () => {
  const table = sql.match(/CREATE TABLE public\.deleted_desk_links[\s\S]*?;/)?.[0] ?? ''
  assert.match(table, /REFERENCES public\.profiles\(id\) ON DELETE CASCADE/)
  assert.doesNotMatch(table, /title|description|share_snapshot|image|owner_name/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.deleted_desk_links FROM PUBLIC, anon, authenticated/)
});

test('削除前の公開範囲と現在のプロフィール公開設定を両方確認する', () => {
  assert.match(sql, /BEFORE DELETE ON public\.desks/)
  assert.match(sql, /OLD\.visibility IN \('public', 'unlisted'\) AND OLD\.owner_profile_public/)
  assert.match(sql, /AND l\.allow_owner_link\s+AND p\.profile_discoverable/)
  assert.match(sql, /p\.public_avatar_url/)
  assert.doesNotMatch(sql, /p\.avatar_url|p\.username/)
});

test('非公開は状態だけ返し、元のアプリ RPC を置き換えない', () => {
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.desks WHERE id = p_desk_id\) THEN\s+RETURN jsonb_build_object\('status', 'private'\);/)
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION public\.get_link_shared_desk\(/)
});
