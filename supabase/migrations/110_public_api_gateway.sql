CREATE TABLE account_security.public_api_gateway (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  secret_hash TEXT NOT NULL
);
ALTER TABLE account_security.public_api_gateway ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security.public_api_gateway FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.configure_public_api_gateway(p_secret TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF char_length(p_secret) < 32 OR p_secret IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_API_SECRET_TOO_SHORT';
  END IF;
  INSERT INTO account_security.public_api_gateway (secret_hash)
  VALUES (encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
  ON CONFLICT (singleton) DO UPDATE SET secret_hash = EXCLUDED.secret_hash;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_public_api_gateway(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_public_api_gateway(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.check_account_access()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret TEXT;
BEGIN
  IF auth.role() = 'authenticated' AND NOT account_security.session_active() THEN
    RAISE EXCEPTION 'ACCOUNT_ACCESS_REVOKED' USING ERRCODE = 'PT401';
  END IF;
  IF auth.role() = 'anon' THEN
    v_secret := current_setting('request.headers', true)::jsonb->>'x-public-api-secret';
    IF v_secret IS NULL OR NOT EXISTS (
      SELECT 1 FROM account_security.public_api_gateway
      WHERE secret_hash = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex')
    ) THEN
      RAISE EXCEPTION 'PUBLIC_API_GATEWAY_REQUIRED' USING ERRCODE = 'PT403';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.check_account_access() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_account_access() TO anon, authenticated, service_role;

ALTER ROLE anon SET statement_timeout = '3s';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
