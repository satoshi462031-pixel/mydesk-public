-- AI の回数枠は利用者向け表示として残し、実原価の安全弁として週次トークン予算を追加する。
-- 入力トークン実数 + 最大出力を生成前に予約し、生成後に実使用量へ精算する。

ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS token_count BIGINT NOT NULL DEFAULT 0;

ALTER TABLE public.ai_usage
  DROP CONSTRAINT IF EXISTS ai_usage_token_count_nonnegative;
ALTER TABLE public.ai_usage
  ADD CONSTRAINT ai_usage_token_count_nonnegative CHECK (token_count >= 0);

ALTER TABLE public.ai_requests
  ADD COLUMN IF NOT EXISTS reserved_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS actual_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS token_period TEXT;

ALTER TABLE public.ai_requests
  DROP CONSTRAINT IF EXISTS ai_requests_reserved_tokens_nonnegative;
ALTER TABLE public.ai_requests
  ADD CONSTRAINT ai_requests_reserved_tokens_nonnegative
    CHECK (reserved_tokens IS NULL OR reserved_tokens >= 0);
ALTER TABLE public.ai_requests
  DROP CONSTRAINT IF EXISTS ai_requests_actual_tokens_nonnegative;
ALTER TABLE public.ai_requests
  ADD CONSTRAINT ai_requests_actual_tokens_nonnegative
    CHECK (actual_tokens IS NULL OR actual_tokens >= 0);

CREATE OR REPLACE FUNCTION public.reserve_ai_tokens(
  p_user_id UUID,
  p_request_id UUID,
  p_tokens INTEGER
)
RETURNS TABLE(allowed BOOLEAN, token_count BIGINT, token_limit BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT := to_char(now(), 'IYYY-"W"IW');
  v_limit  BIGINT := 100000;
  v_usage  public.ai_usage%ROWTYPE;
  v_request public.ai_requests%ROWTYPE;
BEGIN
  IF p_tokens <= 0 THEN
    RAISE EXCEPTION 'tokens must be positive';
  END IF;

  SELECT * INTO v_request FROM public.ai_requests
  WHERE user_id = p_user_id AND request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'processing' THEN
    RAISE EXCEPTION 'request is not processing';
  END IF;

  -- 生成後・完了記録前にプロセスが落ちたリクエストは、再実行時に旧実績を戻す。
  IF v_request.actual_tokens IS NOT NULL AND v_request.token_period IS NOT NULL THEN
    UPDATE public.ai_usage
    SET token_count = GREATEST(token_count - v_request.actual_tokens, 0), updated_at = now()
    WHERE user_id = p_user_id AND period = v_request.token_period;
    UPDATE public.ai_requests
    SET reserved_tokens = NULL, actual_tokens = NULL, token_period = NULL, updated_at = now()
    WHERE user_id = p_user_id AND request_id = p_request_id;
    v_request.reserved_tokens := NULL;
    v_request.actual_tokens := NULL;
    v_request.token_period := NULL;
  END IF;

  IF v_request.reserved_tokens IS NOT NULL AND v_request.reserved_tokens > 0 THEN
    SELECT * INTO v_usage FROM public.ai_usage
    WHERE user_id = p_user_id AND period = v_request.token_period;
    RETURN QUERY SELECT true, COALESCE(v_usage.token_count, 0), v_limit;
    RETURN;
  END IF;

  INSERT INTO public.ai_usage (user_id, period)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period) DO NOTHING;

  SELECT * INTO v_usage FROM public.ai_usage
  WHERE user_id = p_user_id AND period = v_period
  FOR UPDATE;

  IF v_usage.token_count + p_tokens > v_limit THEN
    RETURN QUERY SELECT false, v_usage.token_count, v_limit;
    RETURN;
  END IF;

  UPDATE public.ai_usage AS t
  SET token_count = t.token_count + p_tokens, updated_at = now()
  WHERE t.user_id = p_user_id AND t.period = v_period
  RETURNING t.* INTO v_usage;

  UPDATE public.ai_requests
  SET reserved_tokens = p_tokens, actual_tokens = NULL, token_period = v_period, updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id;

  RETURN QUERY SELECT true, v_usage.token_count, v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_ai_tokens(
  p_user_id UUID,
  p_request_id UUID,
  p_actual_tokens INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.ai_requests%ROWTYPE;
BEGIN
  IF p_actual_tokens < 0 THEN
    RAISE EXCEPTION 'actual tokens must be nonnegative';
  END IF;

  SELECT * INTO v_request FROM public.ai_requests
  WHERE user_id = p_user_id AND request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'processing' THEN
    RAISE EXCEPTION 'request is not processing';
  END IF;
  IF v_request.actual_tokens IS NOT NULL THEN
    RETURN;
  END IF;
  IF v_request.reserved_tokens IS NULL OR v_request.token_period IS NULL THEN
    RAISE EXCEPTION 'token reservation not found';
  END IF;
  IF p_actual_tokens > v_request.reserved_tokens THEN
    RAISE EXCEPTION 'actual tokens exceed reservation';
  END IF;

  UPDATE public.ai_usage
  SET token_count = GREATEST(token_count - v_request.reserved_tokens + p_actual_tokens, 0),
      updated_at = now()
  WHERE user_id = p_user_id AND period = v_request.token_period;

  UPDATE public.ai_requests
  SET actual_tokens = p_actual_tokens, reserved_tokens = 0, updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_tokens(
  p_user_id UUID,
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.ai_requests%ROWTYPE;
  v_charge INTEGER;
BEGIN
  SELECT * INTO v_request FROM public.ai_requests
  WHERE user_id = p_user_id AND request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status = 'completed' OR v_request.token_period IS NULL THEN
    RETURN;
  END IF;

  v_charge := COALESCE(v_request.actual_tokens, v_request.reserved_tokens, 0);
  IF v_charge > 0 THEN
    UPDATE public.ai_usage
    SET token_count = GREATEST(token_count - v_charge, 0), updated_at = now()
    WHERE user_id = p_user_id AND period = v_request.token_period;
  END IF;

  UPDATE public.ai_requests
  SET reserved_tokens = NULL, actual_tokens = NULL, token_period = NULL, updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_tokens(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_ai_tokens(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ai_tokens(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_tokens(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_tokens(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_tokens(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
