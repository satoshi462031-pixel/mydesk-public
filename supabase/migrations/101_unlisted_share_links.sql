-- デスクIDを過去に通常公開した場合も、限定公開のリンクを独立して失効できるようにする。
-- 共有IDは既存のUUID/短縮UUIDルートで扱う。有効期限は設けない。
-- 所持者が共有IDと同じ実デスクIDを登録してリンクを差し替えられないよう、名前空間を分ける。
ALTER TABLE public.desks ADD CONSTRAINT desks_id_not_share_token
  CHECK (substring(id::text FROM 15 FOR 1) <> '8');

CREATE FUNCTION public.new_unlisted_share_token()
RETURNS UUID
LANGUAGE sql VOLATILE SET search_path = public
AS $$
  SELECT overlay(gen_random_uuid()::text PLACING '8' FROM 15 FOR 1)::uuid;
$$;
REVOKE ALL ON FUNCTION public.new_unlisted_share_token() FROM PUBLIC, anon, authenticated;

CREATE TABLE public.unlisted_desk_links (
  desk_id UUID PRIMARY KEY REFERENCES public.desks(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT public.new_unlisted_share_token(),
  CHECK (substring(token::text FROM 15 FOR 1) = '8'),
  CHECK (token <> desk_id)
);
ALTER TABLE public.unlisted_desk_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unlisted_desk_links FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.sync_unlisted_desk_link()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.visibility = 'unlisted' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.unlisted_desk_links (desk_id) VALUES (NEW.id);
    ELSIF OLD.visibility <> 'unlisted' THEN
      INSERT INTO public.unlisted_desk_links (desk_id) VALUES (NEW.id)
      ON CONFLICT (desk_id) DO UPDATE SET token = public.new_unlisted_share_token();
    END IF;
  ELSE
    DELETE FROM public.unlisted_desk_links WHERE desk_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_unlisted_desk_link() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER desks_sync_unlisted_link
  AFTER INSERT OR UPDATE OF visibility ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.sync_unlisted_desk_link();

-- 適用すると既存の限定公開の実IDリンクは失効する。所有者は新しいURLを共有し直す。
INSERT INTO public.unlisted_desk_links (desk_id)
SELECT id FROM public.desks WHERE visibility = 'unlisted';

CREATE FUNCTION public.resolve_link_shared_desk_id(p_identifier UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d.id FROM public.desks d
  LEFT JOIN public.unlisted_desk_links l ON l.desk_id = d.id
  WHERE (d.visibility = 'public' AND d.id = p_identifier)
     OR (d.visibility = 'unlisted' AND l.token = p_identifier)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_link_shared_desk_id(UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_desk_share_identifier(p_desk_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN d.visibility = 'public' THEN d.id ELSE l.token END
  FROM public.desks d
  LEFT JOIN public.unlisted_desk_links l ON l.desk_id = d.id
  WHERE (d.visibility = 'public' AND d.id = p_desk_id)
     OR (d.visibility = 'unlisted' AND (
       l.token = p_desk_id OR (d.id = p_desk_id AND d.user_id = auth.uid())
     ))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_desk_share_identifier(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_desk_share_identifier(UUID) TO anon, authenticated;

CREATE FUNCTION public.reissue_unlisted_desk_link(p_desk_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_visibility TEXT;
  v_token UUID;
BEGIN
  -- 公開範囲の変更・停止と再発行を同じ行ロックで直列化する。
  SELECT visibility INTO v_visibility FROM public.desks
  WHERE id = p_desk_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUBLICATION_OWNER_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF v_visibility <> 'unlisted' THEN
    RAISE EXCEPTION 'DESK_NOT_UNLISTED' USING ERRCODE = '22023';
  END IF;
  UPDATE public.unlisted_desk_links SET token = public.new_unlisted_share_token()
  WHERE desk_id = p_desk_id RETURNING token INTO v_token;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'UNLISTED_LINK_MISSING';
  END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.reissue_unlisted_desk_link(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reissue_unlisted_desk_link(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_link_shared_desk(p_desk_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT to_jsonb(d) || jsonb_build_object(
    'desk_photos', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) - 'pending_revocation_url' ORDER BY p.sort_order)
      FROM public.desk_photos p WHERE p.desk_id = d.id
    ), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM public.devices v WHERE v.desk_id = d.id), '[]'::jsonb),
    'connections', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.connections c WHERE c.desk_id = d.id), '[]'::jsonb)
  ) FROM public.desks d
  WHERE d.id = public.resolve_link_shared_desk_id(p_desk_id);
$$;
REVOKE ALL ON FUNCTION public.get_link_shared_desk(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_link_shared_desk(UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_link_shared_desk_meta(p_desk_id UUID)
RETURNS TABLE (title TEXT, description TEXT, image_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d.title, d.description,
    (SELECT p.image_url FROM public.desk_photos p WHERE p.desk_id = d.id ORDER BY p.sort_order LIMIT 1)
  FROM public.desks d WHERE d.id = public.resolve_link_shared_desk_id(p_desk_id);
$$;
REVOKE ALL ON FUNCTION public.get_link_shared_desk_meta(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_link_shared_desk_meta(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
