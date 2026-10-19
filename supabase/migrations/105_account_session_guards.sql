CREATE SCHEMA IF NOT EXISTS account_security;
REVOKE ALL ON SCHEMA account_security FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA account_security TO anon, authenticated;

CREATE FUNCTION account_security.account_enabled(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_user_id
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
  );
$$;
REVOKE ALL ON FUNCTION account_security.account_enabled(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION account_security.account_enabled(UUID) TO anon, authenticated;

CREATE FUNCTION account_security.session_active()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
    WHERE u.id = auth.uid()
      AND s.id = CASE
        WHEN auth.jwt()->>'session_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (auth.jwt()->>'session_id')::UUID
      END
      AND u.deleted_at IS NULL
      AND (u.banned_until IS NULL OR u.banned_until <= statement_timestamp())
      AND (s.not_after IS NULL OR s.not_after > statement_timestamp())
  );
$$;
REVOKE ALL ON FUNCTION account_security.session_active() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION account_security.session_active() TO authenticated;

-- SECURITY DEFINER の RPC は RLS を通らないため、Data API の入口でも確認する。
CREATE FUNCTION public.check_account_access()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NOT account_security.session_active() THEN
    RAISE EXCEPTION 'ACCOUNT_ACCESS_REVOKED' USING ERRCODE = 'PT401';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.check_account_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_account_access() TO anon, authenticated, service_role;

-- Realtime と Storage は Data API のフックを通らない。既存の許可ポリシーに AND 条件を足す。
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relrowsecurity AND c.relkind IN ('r', 'p')
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
  LOOP
    EXECUTE format(
      'CREATE POLICY account_session_required ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT account_security.session_active()))
       WITH CHECK ((SELECT account_security.session_active()))', r.nspname, r.relname);
  END LOOP;
END;
$$;

CREATE POLICY desk_owner_account_enabled ON public.desks
AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (account_security.account_enabled(user_id));

CREATE OR REPLACE FUNCTION public.resolve_link_shared_desk_id(p_identifier UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT d.id FROM public.desks d
  LEFT JOIN public.unlisted_desk_links l ON l.desk_id = d.id
  WHERE account_security.account_enabled(d.user_id)
    AND ((d.visibility = 'public' AND d.id = p_identifier)
      OR (d.visibility = 'unlisted' AND l.token = p_identifier))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_link_shared_desk_id(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_desk_share_identifier(p_desk_id UUID)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN d.visibility = 'public' THEN d.id ELSE l.token END
  FROM public.desks d
  LEFT JOIN public.unlisted_desk_links l ON l.desk_id = d.id
  WHERE account_security.account_enabled(d.user_id)
    AND ((d.visibility = 'public' AND d.id = p_desk_id)
      OR (d.visibility = 'unlisted' AND (
        l.token = p_desk_id OR (d.id = p_desk_id AND d.user_id = auth.uid())
      )))
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_desk_share_identifier(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_desk_share_identifier(UUID) TO anon, authenticated;

-- 本番に別のフックがある場合は、上書きせず既存処理への組み込みを要求する。
DO $$
DECLARE v_hook TEXT;
BEGIN
  SELECT substring(setting FROM length('pgrst.db_pre_request=') + 1) INTO v_hook
  FROM pg_roles r, unnest(r.rolconfig) setting
  WHERE r.rolname = 'authenticator' AND setting LIKE 'pgrst.db_pre_request=%';
  IF v_hook IS NOT NULL AND v_hook <> '' AND v_hook <> 'public.check_account_access' THEN
    RAISE EXCEPTION 'Existing db_pre_request must include public.check_account_access: %', v_hook;
  END IF;
END;
$$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.check_account_access';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
