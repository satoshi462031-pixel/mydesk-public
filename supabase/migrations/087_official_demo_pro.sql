-- =============================================================
-- Migration 087: 公式デモの所有アカウントをProとして扱う
--
-- 公式アカウントはストア契約を持たない運用アカウントなので、既知のデモデスクを
-- 所有していることを権利の根拠にする。一般ユーザーが公式デモを閲覧しただけでは
-- そのユーザーの権利は変わらない。
-- =============================================================

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
    FROM public.desks d
    WHERE d.user_id = p_user_id
      AND d.id = ANY(ARRAY[
        '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
        '458fa607-269b-421d-a619-01375992fb97',
        'c40c79b0-5aaa-47fb-a271-a5e45026c230',
        'ebab39f1-c298-411a-9b79-40c89837e313'
      ]::UUID[])
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.subscriptions s ON s.user_id = p.id
    WHERE p.id = p_user_id
      AND p.tier = 'pro'
      AND (
        s.user_id IS NULL
        OR s.expires_at IS NULL
        OR s.expires_at > now() - interval '3 days'
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_pro_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pro_user(UUID) TO authenticated, service_role;

-- 公開ページの履歴制限も同じ扱いにする。新規・再公開時にFreeへ戻らないよう、
-- 既知のデモを1件でも所有するアカウントのデスクはowner_tierをProで保存する。
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
    CASE WHEN p.tier = 'pro' OR NEW.id = ANY(ARRAY[
      '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
      '458fa607-269b-421d-a619-01375992fb97',
      'c40c79b0-5aaa-47fb-a271-a5e45026c230',
      'ebab39f1-c298-411a-9b79-40c89837e313'
    ]::UUID[]) OR EXISTS (
      SELECT 1 FROM public.desks official
      WHERE official.user_id = NEW.user_id
        AND official.id = ANY(ARRAY[
          '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
          '458fa607-269b-421d-a619-01375992fb97',
          'c40c79b0-5aaa-47fb-a271-a5e45026c230',
          'ebab39f1-c298-411a-9b79-40c89837e313'
        ]::UUID[])
    ) THEN 'pro' ELSE 'free' END
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
  v_tier := CASE WHEN NEW.tier = 'pro' OR EXISTS (
    SELECT 1 FROM public.desks official
    WHERE official.user_id = NEW.id
      AND official.id = ANY(ARRAY[
        '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
        '458fa607-269b-421d-a619-01375992fb97',
        'c40c79b0-5aaa-47fb-a271-a5e45026c230',
        'ebab39f1-c298-411a-9b79-40c89837e313'
      ]::UUID[])
  ) THEN 'pro' ELSE 'free' END;

  UPDATE public.desks
  SET owner_tier = v_tier
  WHERE user_id = NEW.id
    AND owner_tier IS DISTINCT FROM v_tier;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  demo_desk_ids UUID[] := ARRAY[
    '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
    '458fa607-269b-421d-a619-01375992fb97',
    'c40c79b0-5aaa-47fb-a271-a5e45026c230',
    'ebab39f1-c298-411a-9b79-40c89837e313'
  ]::UUID[];
BEGIN
  ALTER TABLE public.desks DISABLE TRIGGER desks_set_owner_tag;
  UPDATE public.desks
  SET owner_tier = 'pro'
  WHERE user_id IN (SELECT user_id FROM public.desks WHERE id = ANY(demo_desk_ids))
    AND owner_tier IS DISTINCT FROM 'pro';
  ALTER TABLE public.desks ENABLE TRIGGER desks_set_owner_tag;
END;
$$;

REVOKE ALL ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_desk_owner_tier() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
