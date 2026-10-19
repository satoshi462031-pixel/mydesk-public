import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/096_notification_prefs_and_clap_push.sql', 'utf8')
const notifyFollowers = readFileSync('supabase/functions/notify-followers/index.ts', 'utf8')

test('通知の設定は本人しか読み書きできず、匿名には触らせない', () => {
  for (const op of ['SELECT', 'INSERT', 'UPDATE']) {
    const policy = migration.match(new RegExp(`CREATE POLICY "notification_prefs_\\w+" ON public\\.notification_prefs\\s+FOR ${op}[\\s\\S]*?;`))?.[0]
    assert.ok(policy, op)
    assert.match(policy, /auth\.uid\(\) = user_id/)
  }
  assert.match(migration, /REVOKE ALL ON public\.notification_prefs FROM anon;/)
})

test('拍手の通知の送信記録はサービスロールだけが触る', () => {
  assert.match(migration, /REVOKE ALL ON public\.clap_push_log FROM anon, authenticated;/)
})

test('フォローの行で書き換えられるのは notify だけ（既定の全列 UPDATE を外してから付け直す）', () => {
  const revoke = migration.indexOf('REVOKE UPDATE ON public.user_follows FROM authenticated;')
  const grant = migration.indexOf('GRANT UPDATE (notify) ON public.user_follows TO authenticated;')
  assert.ok(revoke >= 0 && revoke < grant)
})

test('フォロワーへの通知は、人ごとの通知と種類ごとの設定の両方を見る', () => {
  assert.match(notifyFollowers, /\.eq\('notify', true\)/)
  assert.match(notifyFollowers, /\.eq\('follow_updates', false\)/)
})
