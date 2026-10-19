-- =============================================================
-- 046_profiles_select_own.sql — profiles の公開読み取りを止める
--
--   本番の profiles は anon キー（アプリにバンドルされ、端末から取り出せる）で
--   全行読めていた。列は id / username / created_at / tier / tier_updated_at /
--   display_name / avatar_url / bio で、tier=eq.pro で絞れば課金ユーザーだけを
--   名指しで抽出できる状態だった。
--
--   リポジトリ側の定義は schema.sql の profiles_select_own（auth.uid() = id）
--   だけで、公開読み取りを許すポリシーは 001〜045 のどこにも無い。本番にだけ
--   手で入ったポリシー、または RLS 無効化が原因。026 のコメントにある
--   「本番だけ username が NOT NULL」と同じ、本番とリポジトリの乖離。
--
--   外から見分けられないので、原因を特定せずに意図した状態へ作り直す。
--   何が入っていたかは NOTICE に出るので、適用時のログを見れば乖離の中身が分かる。
--
--   アプリが profiles を読むのは services/profiles.ts と publishService.ts の
--   2箇所だけで、どちらも .eq('id', auth.getUser() のUUID) なので、
--   自分の行だけに絞っても機能は壊れない。worker と Edge Functions は
--   service_role で読むため RLS を迂回する。
-- =============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 名前が分からないポリシーも確実に落とす。schema.sql が定義しているのは
-- select_own / update_own の2つだけなので、それ以外は乖離とみなして消す。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    RAISE NOTICE '046: dropping existing policy on public.profiles: %', r.policyname;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- schema.sql は USING だけを書いている（省略された WITH CHECK には Postgres が
-- USING と同じ式を使う）。挙動は変えず、意図が読めるように明示する。
-- tier / tier_updated_at の書き換えは 014・019 の protect_profile_tier() が別途弾く。
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

NOTIFY pgrst, 'reload schema';
