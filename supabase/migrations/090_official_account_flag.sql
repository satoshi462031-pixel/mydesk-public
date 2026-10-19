-- =============================================================
-- Migration 090: 公式アカウントの判定をデスクIDから profiles の印へ移す
--
-- 087 は「既知のデモデスクIDのデスクを持っている」ことを Pro の根拠にしていた。
-- desks_insert_own は user_id しか縛らず、id はクライアントが決めて INSERT できる。
-- デモのIDはアプリに同梱されている（src/constants/demoDeskLinks.ts）ので、
-- デモを消す・作り直した時点で、そのIDでデスクを作った誰でも Pro（AIコーチ込み）になれた。
-- いまはデモが実在して主キーで弾かれているだけで、運用の一手で開く穴だった。
--
-- 印（is_official）は本人からは書けない。tier と同じく、フラグを立てた
-- トランザクションの中でしか変わらない（019 の protect_profile_tier と同じ作り）。
--
-- ■ 新しい環境で公式アカウントを作ったとき（087 の「最初に入れたデモで Pro」は廃止）:
--   BEGIN;
--   SELECT set_config('app.bypass_official_protection', 'on', true);
--   UPDATE public.profiles SET is_official = true WHERE id = '<公式アカウントの user_id>';
--   COMMIT;
--
-- 088 の admin_community_overview は集計から公式を除くためにデモIDを見ているが、
-- 権限には効かない（偽装しても自分が集計から外れるだけ）ので触らない。
-- 055 以降の search_public_desks のデモID（英語の検索語の付与）も同じ理由で触らない。
-- =============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_official IS
  '運営の公式アカウント（090）。本人は書けない。Pro 扱いと公開デスクの owner_tier に効く';

-- ─── 1) 本人から書けないようにする ──────────────────────────────
-- profiles_update_own は行単位なので列を縛れない。列の権限を REVOKE しても
-- 表の UPDATE 権限が残る限り効かないため、tier と同じくトリガで戻す。
-- INSERT も見る（いまクライアント向けの INSERT ポリシーは無いが、足されたときに素通りさせない）
CREATE OR REPLACE FUNCTION public.protect_profile_official()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.bypass_official_protection', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.is_official := false;
    ELSE
      NEW.is_official := OLD.is_official;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_official() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_protect_official ON public.profiles;
CREATE TRIGGER profiles_protect_official
  BEFORE INSERT OR UPDATE OF is_official ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_official();

-- ─── 2) いまの公式アカウントに印を付ける ─────────────────────────
-- 087 と同じ引き方で、いまデモを持っているアカウントを移す。移した後は
-- デモを消しても作り直しても、判定は印だけを見る
DO $$
DECLARE
  -- src/constants/demoDeskLinks.ts の deskId（087 と同じ）
  demo_desk_ids UUID[] := ARRAY[
    '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
    '458fa607-269b-421d-a619-01375992fb97',
    'c40c79b0-5aaa-47fb-a271-a5e45026c230',
    'ebab39f1-c298-411a-9b79-40c89837e313'
  ]::UUID[];
BEGIN
  PERFORM set_config('app.bypass_official_protection', 'on', true);
  UPDATE public.profiles
  SET is_official = true
  WHERE id IN (SELECT user_id FROM public.desks WHERE id = ANY(demo_desk_ids))
    AND is_official IS DISTINCT FROM true;
  PERFORM set_config('app.bypass_official_protection', 'off', true);
END;
$$;

-- ─── 3) Pro の判定（087 の版からデモIDを印に置き換えただけ）──────────
CREATE OR REPLACE FUNCTION public.is_pro_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.subscriptions s ON s.user_id = p.id
    WHERE p.id = p_user_id
      AND (
        p.is_official
        OR (
          p.tier = 'pro'
          AND (
            s.user_id IS NULL
            OR s.expires_at IS NULL
            OR s.expires_at > now() - interval '3 days'
          )
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_pro_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pro_user(UUID) TO authenticated, service_role;

-- ─── 4) 公開デスクの owner_tier ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT
    p.public_tag,
    p.profile_discoverable,
    p.public_avatar_url,
    CASE WHEN p.tier = 'pro' OR p.is_official THEN 'pro' ELSE 'free' END
    INTO NEW.owner_tag, NEW.owner_profile_public, NEW.owner_avatar_url, NEW.owner_tier
  FROM public.profiles p
  WHERE p.id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_desk_owner_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier TEXT;
BEGIN
  v_tier := CASE WHEN NEW.tier = 'pro' OR NEW.is_official THEN 'pro' ELSE 'free' END;

  UPDATE public.desks
  SET owner_tier = v_tier
  WHERE user_id = NEW.id
    AND owner_tier IS DISTINCT FROM v_tier;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_desk_owner_tier() FROM PUBLIC, anon, authenticated;

-- 印を付け外ししたときも公開中のデスクへ伝える
DROP TRIGGER IF EXISTS profiles_sync_desk_owner_tier ON public.profiles;
CREATE TRIGGER profiles_sync_desk_owner_tier
  AFTER UPDATE OF tier, is_official ON public.profiles
  FOR EACH ROW
  WHEN (NEW.tier IS DISTINCT FROM OLD.tier OR NEW.is_official IS DISTINCT FROM OLD.is_official)
  EXECUTE FUNCTION public.sync_desk_owner_tier();

NOTIFY pgrst, 'reload schema';
