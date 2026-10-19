-- 削除後に残すのは ID と公開アカウントへの導線の可否だけ。本文・写真・機材は保持しない。
-- アカウント削除時は記録も削除する。適用前に消えたデスクは復元・推測しない。
CREATE TABLE public.deleted_desk_links (
  desk_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  allow_owner_link BOOLEAN NOT NULL
);

ALTER TABLE public.deleted_desk_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deleted_desk_links FROM PUBLIC, anon, authenticated;
CREATE INDEX deleted_desk_links_user_idx ON public.deleted_desk_links (user_id);

CREATE FUNCTION public.remember_deleted_desk_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.deleted_desk_links (desk_id, user_id, allow_owner_link)
  SELECT OLD.id, p.id,
         OLD.visibility IN ('public', 'unlisted') AND OLD.owner_profile_public
  FROM public.profiles p
  WHERE p.id = OLD.user_id
  FOR KEY SHARE
  ON CONFLICT (desk_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, allow_owner_link = EXCLUDED.allow_owner_link;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.remember_deleted_desk_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER desks_remember_deleted_link
  BEFORE DELETE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.remember_deleted_desk_link();

-- 既存アプリの get_link_shared_desk は変えず、Web 用に状態を含めて一度に返す。
CREATE FUNCTION public.get_public_desk_page(p_desk_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_desk JSONB;
  v_owner JSONB;
BEGIN
  v_desk := public.get_link_shared_desk(p_desk_id);
  IF v_desk IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'available', 'desk', v_desk);
  END IF;

  IF EXISTS (SELECT 1 FROM public.desks WHERE id = p_desk_id) THEN
    RETURN jsonb_build_object('status', 'private');
  END IF;

  IF EXISTS (SELECT 1 FROM public.deleted_desk_links WHERE desk_id = p_desk_id) THEN
    SELECT jsonb_build_object(
      'user_id', p.id,
      'owner_name', CASE WHEN strpos(COALESCE(p.display_name, ''), '@') = 0 THEN p.display_name END,
      'owner_tag', p.public_tag,
      'owner_avatar_url', p.public_avatar_url,
      'has_public_desks', EXISTS (
        SELECT 1 FROM public.desks d
        WHERE d.user_id = p.id AND d.visibility = 'public' AND d.owner_profile_public
      )
    ) INTO v_owner
    FROM public.deleted_desk_links l
    JOIN public.profiles p ON p.id = l.user_id
    WHERE l.desk_id = p_desk_id
      AND l.allow_owner_link
      AND p.profile_discoverable;
    RETURN jsonb_build_object('status', 'deleted', 'owner', v_owner);
  END IF;

  RETURN jsonb_build_object('status', 'missing');
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_desk_page(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_desk_page(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
