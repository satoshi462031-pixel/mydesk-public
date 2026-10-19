-- =============================================================
-- 025_backups_pro_only.sql
--   自動バックアップは Pro 限定の機能だが、判定がクライアント
--   （RootNavigator の hasFeature('autoBackup')）にしか無く、018 の
--   RLS は tier を見ていなかった。anon キーは端末から取り出せるので、
--   無料ユーザーが backups へ直接 INSERT して容量を使える状態だった。
--   014 の public_page_config と同じ形でサーバー側にも判定を置く。
--
--   SELECT / DELETE は絞らない。Pro をやめたユーザーが、預けてある
--   バックアップを復元・削除できなくなるのを避けるため（新規に積むのは
--   止めるが、既に預かっている世代は本人のデータとして触れる）。
-- =============================================================

DROP POLICY IF EXISTS "backups_insert" ON public.backups;
CREATE POLICY "backups_insert" ON public.backups
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.tier = 'pro'
    )
  );

NOTIFY pgrst, 'reload schema';
