-- Free users keep the existing monthly period. Pro users use an ISO-week period.
-- This lets both tiers share the same ai_usage table without rewriting history.
CREATE OR REPLACE FUNCTION public.get_ai_usage()
RETURNS TABLE(msg_count INTEGER, photo_count INTEGER, msg_limit INTEGER, photo_limit INTEGER, is_pro BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier   TEXT;
  v_period TEXT;
  v_row    public.ai_usage%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT tier INTO v_tier FROM public.profiles WHERE id = auth.uid();
  v_period := CASE
    WHEN v_tier = 'pro' THEN to_char(now(), 'IYYY-"W"IW')
    ELSE to_char(now(), 'YYYY-MM')
  END;
  SELECT * INTO v_row FROM public.ai_usage WHERE user_id = auth.uid() AND period = v_period;

  RETURN QUERY SELECT
    COALESCE(v_row.msg_count, 0),
    COALESCE(v_row.photo_count, 0),
    CASE WHEN v_tier = 'pro' THEN 50 ELSE 5 END,
    CASE WHEN v_tier = 'pro' THEN 5 ELSE 3 END,
    v_tier = 'pro';
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_ai_usage(p_user_id UUID, p_kind TEXT)
RETURNS TABLE(allowed BOOLEAN, msg_count INTEGER, photo_count INTEGER, msg_limit INTEGER, photo_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period      TEXT;
  v_tier        TEXT;
  v_msg_limit   INTEGER;
  v_photo_limit INTEGER;
  v_row         public.ai_usage%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('msg', 'photo') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  SELECT tier INTO v_tier FROM public.profiles WHERE id = p_user_id;
  v_period      := CASE WHEN v_tier = 'pro' THEN to_char(now(), 'IYYY-"W"IW') ELSE to_char(now(), 'YYYY-MM') END;
  v_msg_limit   := CASE WHEN v_tier = 'pro' THEN 50 ELSE 5 END;
  v_photo_limit := CASE WHEN v_tier = 'pro' THEN 5 ELSE 3 END;

  INSERT INTO public.ai_usage (user_id, period)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period) DO NOTHING;

  SELECT * INTO v_row FROM public.ai_usage
    WHERE user_id = p_user_id AND period = v_period
    FOR UPDATE;

  IF p_kind = 'msg' THEN
    IF v_row.msg_count >= v_msg_limit THEN
      RETURN QUERY SELECT false, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
      RETURN;
    END IF;
    UPDATE public.ai_usage SET msg_count = msg_count + 1, updated_at = now()
      WHERE user_id = p_user_id AND period = v_period
      RETURNING * INTO v_row;
  ELSE
    IF v_row.photo_count >= v_photo_limit THEN
      RETURN QUERY SELECT false, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
      RETURN;
    END IF;
    UPDATE public.ai_usage SET photo_count = photo_count + 1, updated_at = now()
      WHERE user_id = p_user_id AND period = v_period
      RETURNING * INTO v_row;
  END IF;

  RETURN QUERY SELECT true, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ai_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ai_usage() TO authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_usage(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) TO service_role;
