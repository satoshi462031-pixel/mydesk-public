import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// 挙動そのものは PGlite に全マイグレーションを流して確かめた（2026-10-11）。ここでは、
// 後のマイグレーションや手直しで守りが外れないよう、要になる書き方だけを止める
const sql = readFileSync('supabase/migrations/103_authorization_hardening.sql', 'utf8')

function functionBody(name: string): string {
  const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`))
  assert.ok(start >= 0, `${name} is not defined in 103`)
  const open = sql.indexOf('AS $$', start)
  return sql.slice(open, sql.indexOf('$$;', open + 5))
}

test('新しいデスクの拍手数・日時はクライアントの値を使わない', () => {
  const body = functionBody('pin_server_desk_columns')
  for (const column of ['like_count := 0', 'created_at := now()', 'updated_at := now()', 'content_updated_at := NULL']) {
    assert.match(body, new RegExp(`NEW\\.${column.replace(/[()]/g, '\\$&')}`))
  }
  assert.match(body, /NEW\.created_at := OLD\.created_at/)
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.desks\s+FOR EACH ROW EXECUTE FUNCTION public\.pin_server_desk_columns/)
})

test('使われたデスク ID はアカウント削除でも消えず、作り直せない', () => {
  const table = sql.match(/CREATE TABLE public\.retired_desk_ids[\s\S]*?\);/)?.[0] ?? ''
  assert.doesNotMatch(table, /REFERENCES|user_id/)
  assert.match(sql, /BEFORE DELETE ON public\.desks\s+FOR EACH ROW EXECUTE FUNCTION public\.retire_desk_id/)
  assert.match(functionBody('pin_server_desk_columns'), /retired_desk_ids WHERE desk_id = NEW\.id[\s\S]*DESK_ID_RETIRED/)
  assert.match(sql, /REVOKE ALL ON public\.retired_desk_ids FROM PUBLIC, anon, authenticated/)
})

test('運営の非公開化と公開停止は本人から外せない', () => {
  const guard = functionBody('guard_desk_moderation')
  assert.match(guard, /NEW\.moderation_hidden_at := OLD\.moderation_hidden_at/)
  assert.match(guard, /app\.moderation_action/)
  assert.match(guard, /DESK_MODERATION_HIDDEN/)
  assert.match(guard, /PUBLISHING_SUSPENDED/)
  assert.match(functionBody('protect_profile_publishing_suspension'), /NEW\.publishing_suspended_at := OLD\.publishing_suspended_at/)
  for (const fn of ['admin_set_desk_hidden(UUID, BOOLEAN)', 'admin_set_publishing_suspended(UUID, BOOLEAN)']) {
    const escaped = fn.replace(/[()]/g, '\\$&')
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${escaped} FROM PUBLIC, anon, authenticated`))
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${escaped} TO service_role`))
  }
})

test('通報はデスクの削除で消えず、開けないデスクには出せない', () => {
  assert.match(sql, /DROP CONSTRAINT %I/)
  assert.match(sql, /REFERENCES auth\.users\(id\) ON DELETE SET NULL/)
  assert.doesNotMatch(sql, /desk_reports[\s\S]{0,80}REFERENCES public\.desks/)
  const prepare = functionBody('prepare_desk_report')
  assert.match(prepare, /v_visibility NOT IN \('public', 'unlisted'\)/)
  assert.match(prepare, /NEW\.status\s+:= 'open'/)
  assert.match(sql, /char_length\(note\) <= 1000/)
})

test('公開プロフィールを出していない人の @ID と、投稿者の契約をデスクへ写さない', () => {
  const body = functionBody('set_desk_owner_tag')
  assert.match(body, /CASE WHEN p\.profile_discoverable THEN p\.public_tag ELSE '' END/)
  assert.doesNotMatch(body, /tier/)
  assert.match(sql, /ALTER TABLE public\.desks DROP COLUMN IF EXISTS owner_tier/)
})

test('手放された @ID は1年間、手放した本人以外が取れない', () => {
  assert.match(functionBody('public_tag_held_for_other'), /INTERVAL '1 year'[\s\S]*released_by IS DISTINCT FROM p_uid/)
  for (const fn of ['set_public_tag', 'public_tag_available', 'generate_public_tag']) {
    assert.match(functionBody(fn), /public_tag_held_for_other/, fn)
  }
  assert.match(sql, /AFTER UPDATE OF public_tag ON public\.profiles/)
  assert.match(sql, /BEFORE DELETE ON public\.profiles/)
})
