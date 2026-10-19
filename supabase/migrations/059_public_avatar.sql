-- =============================================================
-- Migration 059: 投稿者のアイコンを本人が選んだ写真にできるようにする
--
-- これまでアイコンはニックネームの頭文字と public_tag から作る色だけだった。
--
-- **既存の avatar_url は流用しない。** あの列は handle_new_user（024/026/049）が
-- サインイン時に raw_user_meta_data から自動でコピーしており、Google などで
-- 登録した人には本人が選んでいない顔写真が既に入っている。公開に使う値をあそこから
-- 引くと、一度も選んでいない写真が公開デスクに出る。公開用は別の列にして、
-- 本人がこのアプリで選んだときにしか値が入らないようにする。
--
-- 閲覧側は profiles を読めない（046）ので、owner_name（051）・owner_tag（049）と
-- 同じく desks へ非正規化してコピーする。
-- =============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_avatar_url TEXT;

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS owner_avatar_url TEXT;

-- ─── 1) アイコンだけの変更では更新時刻を進めない ────────────────
-- 051（owner_name）・057（owner_profile_public）と同じ例外。アイコンを変えただけで
-- みんなのデスク（updated_at 降順）が自分のデスクで埋まらないようにする。
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.owner_name IS DISTINCT FROM OLD.owner_name
      OR NEW.owner_profile_public IS DISTINCT FROM OLD.owner_profile_public
      OR NEW.owner_avatar_url IS DISTINCT FROM OLD.owner_avatar_url)
     AND (to_jsonb(NEW) - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'updated_at')
  THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── 2) 新しいデスクにも本人の設定をコピーする ──────────────────
-- 049 / 057 と同じ役目。クライアントが値を偽装しても profiles の確定値で上書きする。
CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT public_tag, profile_discoverable, public_avatar_url
    INTO NEW.owner_tag, NEW.owner_profile_public, NEW.owner_avatar_url
  FROM public.profiles
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desks_set_owner_tag ON public.desks;
CREATE TRIGGER desks_set_owner_tag
  BEFORE INSERT OR UPDATE OF user_id, owner_tag, owner_profile_public, owner_avatar_url ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.set_desk_owner_tag();

-- ─── 3) アイコンの設定（profiles と自分のデスクを同時に更新）──────────
-- 051 の set_public_owner_name と同じ理由でサーバー側に寄せる。
--
-- 受け付けるのは自分のフォルダにアップロードした画像だけ。任意の URL を通すと、
-- 公開デスクを開いた人の端末から他所のサーバーへ取得が飛ぶ（閲覧者の IP が
-- 第三者に渡る）うえ、相手が中身を差し替えれば表示も変わる。
CREATE OR REPLACE FUNCTION public.set_public_avatar_url(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_url    TEXT := NULLIF(BTRIM(COALESCE(p_url, '')), '');
  v_prefix TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_url IS NOT NULL THEN
    v_prefix := '/storage/v1/object/public/desk-images/' || v_uid::TEXT || '/avatar/';
    IF v_url NOT LIKE 'https://%' OR POSITION(v_prefix IN v_url) = 0 THEN
      RAISE EXCEPTION 'avatar must be an uploaded image owned by the caller' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.profiles
  SET public_avatar_url = v_url
  WHERE id = v_uid;

  UPDATE public.desks
  SET owner_avatar_url = v_url
  WHERE user_id = v_uid
    AND owner_avatar_url IS DISTINCT FROM v_url;

  RETURN v_url;
END;
$$;

REVOKE ALL ON FUNCTION public.set_public_avatar_url(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_public_avatar_url(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
