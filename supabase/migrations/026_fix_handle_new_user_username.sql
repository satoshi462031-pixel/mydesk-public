-- =============================================================
-- 026_fix_handle_new_user_username.sql — サインアップ 500 の修正
--
--   本番の public.profiles は username が NOT NULL（リポジトリの
--   schema.sql は NULL 可。本番だけ手動で制約が入っている）。
--   024 で handle_new_user() を差し替えた際に username を入れない実装に
--   したため、NOT NULL 違反でトリガーが失敗し、auth.users の INSERT ごと
--   ロールバックして /auth/v1/signup が 500 (unexpected_failure) になった。
--
--   username はメールアドレスから作らない。publishService が
--   desks.owner_name のフォールバックに使っており、公開ページに出うるため
--   （024 でメールアドレスの露出を止めたのと同じ理由）。
--   UUID から作れば衝突しないので UNIQUE 制約とも競合しない。
-- =============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    'user_' || replace(NEW.id::TEXT, '-', ''),
    COALESCE(
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), '')
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
