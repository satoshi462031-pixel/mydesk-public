-- =============================================================
-- Migration 060: 公開タグ（@ID）を本人が決められるようにする
--
-- 049 のタグは gen_random_uuid() から作る 6 桁の 16 進数で、本人にも運営にも
-- 変えられなかった。名乗りとしては覚えられず、口頭でも紙面でも伝わらないので、
-- 「@A1B2C3 です」と言える人が誰もいない。名前（display_name）は重複を許す設計の
-- ままなので、人を一意に指す文字列はここしかない。本人が決められる形にする。
--
-- 変えられるようにすると /u/<旧タグ> の共有リンクは切れる。ここは受け入れる
-- （転送用の旧タグ表は持たない）。UI 側で変更時に断りを出す。
--
-- 大文字小文字は **表示は入力どおり・一意性と検索は区別しない**。@MyDesk と
-- @mydesk が別人だと、見た目が同じなりすましを許すことになる。
--
-- 予約語（is_reserved_public_tag）は 052 が 000000 でやったことの一般化。
-- 公式やサポートを名乗れる文字列は抽選にも自由入力にも出さない。
-- =============================================================

-- ─── 1) 形式を広げる ────────────────────────────────────────────
-- 既存の 6 桁 16 進はそのまま新しい形式にも収まるので、値の書き換えは要らない。
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_public_tag_format;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_public_tag_format
  CHECK (public_tag ~ '^[A-Za-z0-9_]{3,20}$');

-- ─── 2) 一意性を大文字小文字を無視した比較にする ─────────────────
-- schema.sql は UNIQUE 制約、049 は同名の部分インデックスを作っている。
-- どちらの環境も通るよう両方落としてから貼り直す。
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_public_tag_key;
DROP INDEX IF EXISTS public.profiles_public_tag_key;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_tag_lower_key
  ON public.profiles (LOWER(public_tag));

-- ─── 3) 予約語 ──────────────────────────────────────────────────
-- 公式・運営・サポートを騙れる文字列と、mydesk.page のパスに使っている語。
-- 既存ユーザーの 6 桁 16 進とはぶつからない（000000 は 052 で公式に予約済み）。
CREATE OR REPLACE FUNCTION public.is_reserved_public_tag(p_tag TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(BTRIM(COALESCE(p_tag, ''))) = ANY (ARRAY[
    'mydesk', 'my_desk', 'mydeskofficial', 'mydesk_official', 'mydeskjp', 'mydeskapp',
    'official', 'admin', 'administrator', 'moderator', 'staff', 'support', 'help',
    'info', 'contact', 'security', 'billing', 'root', 'system', 'null', 'undefined',
    'api', 'app', 'www', 'u', 'd', 'desk', 'setup', 'settings', 'login', 'signin',
    'signup', 'terms', 'privacy', 'about', 'blog', '000000'
  ]);
$$;

-- ─── 4) 抽選（新規登録の初期値）を予約語と衝突させない ───────────
-- 052 が 000000 だけを外していたところを、予約語と大文字小文字無視の比較へ広げる。
CREATE OR REPLACE FUNCTION public.generate_public_tag()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 6));
    CONTINUE WHEN public.is_reserved_public_tag(candidate);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE LOWER(public_tag) = LOWER(candidate)
    );
  END LOOP;
  RETURN candidate;
END;
$$;

-- ─── 5) 変更は set_public_tag 経由だけ通す ──────────────────────
-- 049 のトリガは変更を一切許さなかった。profiles は本人が直接 UPDATE できる
-- （046 の profiles_update_own）ので、ここを外すと重複も予約語も素通りする。
-- セッション変数を立てられるのは下の SECURITY DEFINER 関数だけで、
-- PostgREST から set_config を呼ぶ口は無い。
CREATE OR REPLACE FUNCTION public.prevent_public_tag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_tag IS DISTINCT FROM OLD.public_tag
     AND COALESCE(current_setting('app.public_tag_change', TRUE), '') <> 'on' THEN
    RAISE EXCEPTION 'public_tag cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 6) 公開デスクの並び順を @ID の変更で動かさない ──────────────
-- 051（owner_name）・057（owner_profile_public）・059（owner_avatar_url）と同じ例外。
-- owner_tag だけが動いたときに updated_at を進めると、@ID を変えた本人のデスクで
-- みんなのデスク（updated_at 降順）の先頭が埋まる。
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.owner_name IS DISTINCT FROM OLD.owner_name
      OR NEW.owner_profile_public IS DISTINCT FROM OLD.owner_profile_public
      OR NEW.owner_avatar_url IS DISTINCT FROM OLD.owner_avatar_url
      OR NEW.owner_tag IS DISTINCT FROM OLD.owner_tag)
     AND (to_jsonb(NEW) - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'owner_tag' - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'owner_tag' - 'updated_at')
  THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── 7) 閲覧側の検索キー ────────────────────────────────────────
-- 046 で profiles は本人しか読めないので、/u/<tag> は desks.owner_tag を引く。
-- 大文字小文字を無視して引くのに ilike は使えない（@ID に使える _ が
-- LIKE のワイルドカードとして効き、他人のデスクまで一致してしまう）。
-- 小文字の生成列を足して等値で引く。
ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS owner_tag_lower TEXT
  GENERATED ALWAYS AS (LOWER(owner_tag)) STORED;

CREATE INDEX IF NOT EXISTS desks_owner_tag_lower_idx
  ON public.desks (owner_tag_lower)
  WHERE visibility = 'public';

-- ─── 8) 変更の入口 ──────────────────────────────────────────────
-- 051 / 057 / 059 と同じく、profiles と公開済み desks の非正規化コピーを
-- 一度に更新する必要があるためサーバー側に置く。
-- エラーは文言ではなく合図（PUBLIC_TAG_*）で返す。表示の言い回しはアプリが持つ。
CREATE OR REPLACE FUNCTION public.set_public_tag(p_tag TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_tag     TEXT := REGEXP_REPLACE(BTRIM(COALESCE(p_tag, '')), '^[#@]', '');
  v_current TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_tag !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'PUBLIC_TAG_INVALID' USING ERRCODE = '23514';
  END IF;

  SELECT public_tag INTO v_current FROM public.profiles WHERE id = v_uid;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_TAG_NO_PROFILE' USING ERRCODE = 'P0002';
  END IF;

  -- 自分が既に持っている綴りなら、予約語でも大文字小文字だけ直せる（公式の @MyDesk）
  IF LOWER(v_current) IS DISTINCT FROM LOWER(v_tag) THEN
    IF public.is_reserved_public_tag(v_tag) THEN
      RAISE EXCEPTION 'PUBLIC_TAG_RESERVED' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE LOWER(public_tag) = LOWER(v_tag) AND id <> v_uid
    ) THEN
      RAISE EXCEPTION 'PUBLIC_TAG_TAKEN' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_current = v_tag THEN
    RETURN v_tag;
  END IF;

  PERFORM set_config('app.public_tag_change', 'on', TRUE);
  UPDATE public.profiles SET public_tag = v_tag WHERE id = v_uid;
  PERFORM set_config('app.public_tag_change', '', TRUE);

  UPDATE public.desks
  SET owner_tag = v_tag
  WHERE user_id = v_uid
    AND owner_tag IS DISTINCT FROM v_tag;

  RETURN v_tag;
EXCEPTION WHEN unique_violation THEN
  -- 同じ @ID を同時に取りに来た場合。一意インデックスで負けた側をここで畳む
  RAISE EXCEPTION 'PUBLIC_TAG_TAKEN' USING ERRCODE = '23505';
END;
$$;

REVOKE ALL ON FUNCTION public.set_public_tag(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_public_tag(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.generate_public_tag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_public_tag_change() FROM PUBLIC;

-- ─── 9) 公式アカウントを @MyDesk にする ─────────────────────────
-- 052 と同じ手順・同じ対象（公式デモデスクの所有者）。000000 は覚えられるだけで
-- 読めないので、名乗りとして機能する文字列に置き換える。
DO $$
DECLARE
  -- src/constants/demoDeskLinks.ts の deskId（052 と同じ）
  demo_desk_ids UUID[] := ARRAY[
    '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
    '458fa607-269b-421d-a619-01375992fb97',
    'c40c79b0-5aaa-47fb-a271-a5e45026c230',
    'ebab39f1-c298-411a-9b79-40c89837e313'
  ]::UUID[];
  official_tag TEXT := 'MyDesk';
  v_uid     UUID;
  v_current TEXT;
  v_holder  UUID;
BEGIN
  SELECT DISTINCT user_id INTO v_uid
  FROM public.desks
  WHERE id = ANY(demo_desk_ids)
  LIMIT 1;

  -- デモデスクを公開していない環境（ローカル・新規プロジェクト）では何もしない
  IF v_uid IS NULL THEN
    RAISE NOTICE '060: 公式デモデスクが見つからないため @MyDesk の割り当てを飛ばした';
    RETURN;
  END IF;

  SELECT public_tag INTO v_current FROM public.profiles WHERE id = v_uid;
  IF v_current = official_tag THEN
    RAISE NOTICE '060: 公開タグは既に %', official_tag;
    RETURN;
  END IF;

  SELECT id INTO v_holder
  FROM public.profiles
  WHERE LOWER(public_tag) = LOWER(official_tag) AND id <> v_uid;
  IF v_holder IS NOT NULL THEN
    RAISE EXCEPTION '060: 公開タグ % は別のユーザー(%)が使用中', official_tag, v_holder;
  END IF;

  PERFORM set_config('app.public_tag_change', 'on', TRUE);
  UPDATE public.profiles SET public_tag = official_tag WHERE id = v_uid;
  PERFORM set_config('app.public_tag_change', '', TRUE);

  -- 6) で owner_tag は updated_at の例外に入れたが、ここは公式デスクが
  -- フィード先頭に並ぶのを確実に避けたいので 052 と同じくトリガごと外して更新する
  ALTER TABLE public.desks DISABLE TRIGGER desks_updated_at;
  UPDATE public.desks SET owner_tag = official_tag
  WHERE user_id = v_uid AND owner_tag IS DISTINCT FROM official_tag;
  ALTER TABLE public.desks ENABLE TRIGGER desks_updated_at;

  RAISE NOTICE '060: 公開タグを % に設定した (user=%)', official_tag, v_uid;
END;
$$;

NOTIFY pgrst, 'reload schema';
