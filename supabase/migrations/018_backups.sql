-- =============================================================
-- 018_backups.sql
--   Proプランの自動バックアップ。
--
--   デスク・ガジェット・履歴は端末の AsyncStorage にしか無く、公開したデスク
--   以外はサーバーに存在しない。そのため再インストール・機種変更でユーザーの
--   記録が丸ごと失われる。ここでは設定画面の「データをエクスポート」と同じ
--   JSON を定期的に預かり、新しい端末で復元できるようにする。
--
--   ・写真は対象外（ファイル実体は Storage にあり、費用と削除処理が増えるため）
--   ・クライアント側の暗号化は行わない。鍵を失うと復元できず、バックアップの
--     目的そのものが失われる。RLS と Supabase の保管時暗号化に委ねる。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.backups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload        JSONB NOT NULL,
  -- payload.version と同じ値。復元側で古い形式を判別するために列にも持つ
  schema_version INT NOT NULL,
  -- どの端末から上げたバックアップかを復元画面で見分けるための情報
  device_id      TEXT,
  device_name    TEXT,
  byte_size      INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 復元画面は「自分の最新7件」しか引かないので、この複合インデックスで足りる
CREATE INDEX IF NOT EXISTS idx_backups_user_created
  ON public.backups(user_id, created_at DESC);

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

-- 自分のバックアップだけ読める・作れる・消せる。
-- UPDATE のポリシーは意図的に作らない。バックアップは追記専用にしておかないと、
-- 壊れた状態や空データで既存の世代を上書きできてしまう。
DROP POLICY IF EXISTS "backups_select" ON public.backups;
CREATE POLICY "backups_select" ON public.backups
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "backups_insert" ON public.backups;
CREATE POLICY "backups_insert" ON public.backups
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "backups_delete" ON public.backups;
CREATE POLICY "backups_delete" ON public.backups
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 7世代を超えた古いバックアップの削除 ─────────────────────────
-- クライアントに削除させると、アップロード直後にアプリが落ちた・通信が切れた
-- ケースで世代が無限に増える。挿入と同じトランザクションでサーバー側が刈る。
CREATE OR REPLACE FUNCTION public.trim_backups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.backups
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM public.backups
      WHERE user_id = NEW.user_id
      ORDER BY created_at DESC, id DESC
      LIMIT 7
    );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trim_backups ON public.backups;
CREATE TRIGGER trg_trim_backups
  AFTER INSERT ON public.backups
  FOR EACH ROW EXECUTE FUNCTION public.trim_backups();

NOTIFY pgrst, 'reload schema';
