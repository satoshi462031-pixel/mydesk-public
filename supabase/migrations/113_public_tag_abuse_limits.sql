CREATE TABLE account_security.public_tag_usage (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ NOT NULL,
  last_changed_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE account_security.public_tag_changes (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX public_tag_changes_user_time_idx ON account_security.public_tag_changes(user_id, changed_at);
ALTER TABLE account_security.public_tag_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_security.public_tag_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security.public_tag_usage, account_security.public_tag_changes FROM PUBLIC, anon, authenticated;

ALTER TABLE public.released_public_tags ADD COLUMN expires_at TIMESTAMPTZ;
UPDATE public.released_public_tags SET expires_at = released_at + INTERVAL '1 year';
ALTER TABLE public.released_public_tags ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE public.released_public_tags ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '1 year');

CREATE OR REPLACE FUNCTION public.public_tag_held_for_other(p_tag TEXT, p_uid UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.released_public_tags
    WHERE tag_lower = LOWER(BTRIM(COALESCE(p_tag, '')))
      AND expires_at > now() AND released_by IS DISTINCT FROM p_uid
  );
$$;

CREATE OR REPLACE FUNCTION public.release_public_tag()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_usage account_security.public_tag_usage%ROWTYPE;
  v_now TIMESTAMPTZ := statement_timestamp();
  v_expiry TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'UPDATE' AND LOWER(NEW.public_tag) IS NOT DISTINCT FROM LOWER(OLD.public_tag) THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_usage FROM account_security.public_tag_usage WHERE user_id = OLD.id FOR UPDATE;
  -- 導入前のIDは利用開始日を推測せず、従来の1年保護を維持する。
  v_expiry := v_now + CASE WHEN v_usage.acquired_at > v_now - INTERVAL '7 days'
    THEN INTERVAL '1 day' ELSE INTERVAL '1 year' END;
  IF TG_OP = 'UPDATE' THEN
    IF auth.role() = 'authenticated' THEN
      IF auth.uid() IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
      END IF;
      IF v_usage.last_changed_at > v_now - INTERVAL '7 days'
        OR (SELECT count(*) FROM account_security.public_tag_changes
            WHERE user_id = OLD.id AND changed_at > v_now - INTERVAL '90 days') >= 4 THEN
        RAISE EXCEPTION 'PUBLIC_TAG_RATE_LIMITED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    DELETE FROM account_security.public_tag_changes WHERE user_id = OLD.id AND changed_at <= v_now - INTERVAL '90 days';
    INSERT INTO account_security.public_tag_changes(user_id, changed_at) VALUES (OLD.id, v_now);
    INSERT INTO account_security.public_tag_usage VALUES (OLD.id, v_now, v_now)
    ON CONFLICT (user_id) DO UPDATE SET acquired_at = EXCLUDED.acquired_at, last_changed_at = EXCLUDED.last_changed_at;
  END IF;
  INSERT INTO public.released_public_tags(tag_lower, released_by, released_at, expires_at)
  VALUES (LOWER(OLD.public_tag), CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE OLD.id END, v_now, v_expiry)
  ON CONFLICT (tag_lower) DO UPDATE SET released_by = EXCLUDED.released_by,
    released_at = EXCLUDED.released_at, expires_at = EXCLUDED.expires_at;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  DELETE FROM public.released_public_tags WHERE tag_lower = LOWER(NEW.public_tag);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.public_tag_held_for_other(TEXT, UUID), public.release_public_tag() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
