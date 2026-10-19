-- =============================================================
-- 024_owner_name_privacy.sql — 個人情報の露出を止める
--
--   1) 新規ユーザーの profiles.display_name にメールアドレスを入れない。
--      handle_new_user() は full_name が無いとき NEW.email を入れていた。
--      display_name は publishService が desks.owner_name にコピーし、
--      owner_name は公開デスクとして誰でも読めるため、メール登録のユーザーが
--      デスクを公開するとメールアドレスがそのまま公開ページに出ていた。
--   2) 既にメールアドレスが入っている display_name / owner_name を消す。
--   3) desk-images の SELECT を所有者限定にする。
-- =============================================================

-- 本番初期スキーマにはプロフィール表示用の列が無い環境があるため、
-- handle_new_user() を置き換える前に揃える。
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT;

-- ─── 1) サインアップ時にメールアドレスを保存しない ──────────────
-- full_name が無ければ display_name は NULL のままにする。公開ページに出す
-- 名前は設定画面の「デスク名」（AsyncStorage: desk_name）を正とする。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), '')
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

-- ─── 2) 既存データの洗浄 ────────────────────────────────────────
UPDATE public.profiles
SET display_name = NULL
WHERE POSITION('@' IN display_name) > 0;

-- owner_name の更新で updated_at が動くと、公開一覧（updated_at の降順）の
-- 並びが洗浄対象のデスクだけ入れ替わってしまうため、この間だけ止める。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.desks'::regclass
      AND tgname = 'desks_updated_at'
  ) THEN
    ALTER TABLE public.desks DISABLE TRIGGER desks_updated_at;
  END IF;
END;
$$;

UPDATE public.desks
SET owner_name = ''
WHERE POSITION('@' IN owner_name) > 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.desks'::regclass
      AND tgname = 'desks_updated_at'
  ) THEN
    ALTER TABLE public.desks ENABLE TRIGGER desks_updated_at;
  END IF;
END;
$$;

-- ─── 3) desk-images の匿名列挙を止める ──────────────────────────
-- 旧ポリシーは USING (bucket_id = 'desk-images') のみで TO 句が無く、anon にも
-- SELECT が通っていた。anon キーはアプリのバンドルから取り出せるため、誰でも
-- Storage の list API で全ユーザーのフォルダ（<user_id>/<desk_id>/...）を
-- 列挙し、非公開デスクの写真やアバターまで辿れる状態だった。
--
-- バケットは public = true のままにする。公開ページの写真は
-- /object/public/desk-images/... で配信され、この経路は RLS を通らないので
-- 表示は従来どおり動く（アプリ側も getPublicUrl の直リンクしか使っていない）。
-- ここで塞ぐのは認証経由の list / download だけ。
DROP POLICY IF EXISTS "desk_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "desk_images_owner_read"  ON storage.objects;
CREATE POLICY "desk_images_owner_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

NOTIFY pgrst, 'reload schema';
