import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/095_clap_per_content_round.sql', 'utf8')

test('版を進めるトリガは content_updated_at を決めるトリガ（061）の後に走る名前にする', () => {
  // 同じ時点の BEFORE トリガは名前順。061 の名前を頭に含めれば必ず後ろに並ぶ
  const name = migration.match(/CREATE TRIGGER (\w+)\s+BEFORE INSERT OR UPDATE ON public\.desks/)?.[1]
  assert.ok(name)
  assert.ok(name.startsWith('desks_content_updated_at') && name !== 'desks_content_updated_at')
})

test('版はサーバーだけが進め、24時間未満の更新は同じ版にまとめる', () => {
  const fn = migration.match(/FUNCTION public\.advance_desk_clap_round\(\)[\s\S]*?\$\$;/)?.[0]
  assert.ok(fn)
  assert.match(fn, /NEW\.clap_round_at := OLD\.clap_round_at/)
  assert.match(fn, /INTERVAL '24 hours'/)
  assert.match(fn, /TG_OP = 'INSERT'[\s\S]*?NEW\.clap_round_at := now\(\)/)
})

test('既存デスクの埋め戻しでは、updated_at や公開ログのトリガを走らせない', () => {
  const disable = migration.indexOf('ALTER TABLE public.desks DISABLE TRIGGER USER')
  const backfill = migration.indexOf('SET clap_round_at = COALESCE(content_updated_at, created_at)')
  const enable = migration.indexOf('ALTER TABLE public.desks ENABLE TRIGGER USER')
  assert.ok(disable >= 0 && disable < backfill && backfill < enable)
})

test('拍手の版はクライアントの値を使わず、同じ版には1人1件', () => {
  assert.match(migration, /NEW\.round_at := \(SELECT d\.clap_round_at FROM public\.desks d WHERE d\.id = NEW\.desk_id\)/)
  assert.match(migration, /CREATE TRIGGER likes_set_round\s+BEFORE INSERT ON public\.likes/)
  assert.match(migration, /DROP CONSTRAINT IF EXISTS likes_desk_id_user_id_key/)
  assert.match(migration, /UNIQUE \(desk_id, user_id, round_at\)/)
})

test('取り消せるのは本人の、今の版の拍手だけ', () => {
  const policy = migration.match(/CREATE POLICY "likes_delete_own"[\s\S]*?\n {2}\);/)?.[0]
  assert.ok(policy)
  assert.match(policy, /auth\.uid\(\) = user_id/)
  assert.match(policy, /round_at = \(SELECT d\.clap_round_at FROM public\.desks d WHERE d\.id = likes\.desk_id\)/)
})

test('作り直した反応の関数も anon からは呼べない', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_my_desk_reactions\(TIMESTAMPTZ\) FROM PUBLIC, anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_my_desk_reactions\(TIMESTAMPTZ\) TO authenticated;/)
})
