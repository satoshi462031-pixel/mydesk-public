-- 初回Webhookでは subscriptions 行がまだ存在せず、行ロックを取得できない。
-- 必ず存在する profiles 行を先にロックし、同一ユーザーのイベントを直列化する。
CREATE OR REPLACE FUNCTION public.apply_revenuecat_event(
  p_user_id        UUID,
  p_tier           TEXT,
  p_event_id       TEXT,
  p_event_at       TIMESTAMPTZ,
  p_rc_customer_id TEXT DEFAULT NULL,
  p_rc_product_id  TEXT DEFAULT NULL,
  p_rc_entitlement TEXT DEFAULT NULL,
  p_expires_at     TIMESTAMPTZ DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.subscriptions%ROWTYPE;
  v_locked_user_id UUID;
BEGIN
  IF p_tier NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION 'invalid tier: %', p_tier;
  END IF;

  SELECT id INTO v_locked_user_id
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_locked_user_id IS NULL THEN
    RETURN 'unknown_user';
  END IF;

  SELECT * INTO v_row
  FROM public.subscriptions
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.rc_last_event_id IS NOT NULL AND v_row.rc_last_event_id = p_event_id THEN
      RETURN 'duplicate';
    END IF;
    IF v_row.rc_last_event_at IS NOT NULL AND v_row.rc_last_event_at > p_event_at THEN
      RETURN 'stale';
    END IF;
  END IF;

  PERFORM set_config('app.bypass_tier_protection', 'on', true);

  INSERT INTO public.subscriptions (
    user_id, tier, rc_customer_id, rc_product_id, rc_entitlement,
    expires_at, status, rc_last_event_id, rc_last_event_at
  )
  VALUES (
    p_user_id, p_tier, p_rc_customer_id, p_rc_product_id, p_rc_entitlement,
    p_expires_at,
    CASE WHEN p_tier = 'pro' THEN 'active' ELSE 'expired' END,
    p_event_id, p_event_at
  )
  ON CONFLICT (user_id) DO UPDATE
  SET tier             = EXCLUDED.tier,
      rc_customer_id   = COALESCE(EXCLUDED.rc_customer_id, subscriptions.rc_customer_id),
      rc_product_id    = COALESCE(EXCLUDED.rc_product_id, subscriptions.rc_product_id),
      rc_entitlement   = COALESCE(EXCLUDED.rc_entitlement, subscriptions.rc_entitlement),
      expires_at       = EXCLUDED.expires_at,
      status           = EXCLUDED.status,
      rc_last_event_id = EXCLUDED.rc_last_event_id,
      rc_last_event_at = EXCLUDED.rc_last_event_at,
      updated_at       = NOW();

  UPDATE public.profiles
  SET tier = p_tier, tier_updated_at = NOW()
  WHERE id = p_user_id;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_revenuecat_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_revenuecat_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_revenuecat_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
