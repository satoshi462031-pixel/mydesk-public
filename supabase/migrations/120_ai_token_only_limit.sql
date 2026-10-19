-- =============================================================
-- Migration 120: Pro の AI 利用枠を、週のトークン枠だけで判定する
--
-- これまでは「週30回・写真週5枚」の回数枠（036）と、原価の安全弁の週10万トークン（047）の
-- 二重で止めていた。回数は1回の重さ（デスク情報の量・会話の長さ・写真）を見ないので、
-- 短い質問も長い相談も同じ1回で、原価と釣り合わない。
-- 判定をトークン枠1本にし、画面は回数ではなく利用量の割合とリセット日時で見せる。
--
--   Free : 利用不可（035 から変わらず）
--   Pro  : 週 150,000 トークン（入力＋出力の実数。生成前に「入力＋最大出力」を予約し、生成後に精算）
--
-- 枠の大きさの根拠（2026-10-15 時点、Claude Haiku 4.5・入力 $1/M・出力 $5/M・1ドル155円）：
--   1回の実使用はおよそ 6,000 トークン（指示文 約1,500＋デスク情報 約2,000＋会話の履歴＋出力 約600）。
--   150,000 は普通の相談で週25回ほど。使い切っても原価は週 約33円・月 約140円で、
--   Pro の手取り（月590円から Apple の手数料を引いて約500円）の3割弱に収まる。
--
-- msg_count / photo_count は計測のために数え続けるが、上限には使わない。
-- 枠の大きさは ai_weekly_token_limit() の1箇所で変える（予約と表示の両方がここを見る）。
-- =============================================================

CREATE OR REPLACE FUNCTION public.ai_weekly_token_limit()
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 150000::BIGINT;
$$;

-- 予約：047 から上限の値だけを ai_weekly_token_limit() に差し替える
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
  v_limit  BIGINT := public.ai_weekly_token_limit();
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

-- 回数は数えるだけにする。Pro は常に通し、Free は 035 と同じく行を作らずに弾く。
-- 戻り値の形は ai-coach が読むので変えない。msg_limit / photo_limit は上限ではなくなったので 0 を返す
CREATE OR REPLACE FUNCTION public.consume_ai_usage(p_user_id UUID, p_kind TEXT)
RETURNS TABLE(allowed BOOLEAN, msg_count INTEGER, photo_count INTEGER, msg_limit INTEGER, photo_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
  v_row    public.ai_usage%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('msg', 'photo') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  IF NOT public.is_pro_user(p_user_id) THEN
    RETURN QUERY SELECT false, 0, 0, 0, 0;
    RETURN;
  END IF;

  v_period := to_char(now(), 'IYYY-"W"IW');
  INSERT INTO public.ai_usage (user_id, period)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period) DO NOTHING;

  IF p_kind = 'msg' THEN
    UPDATE public.ai_usage AS t SET msg_count = t.msg_count + 1, updated_at = now()
      WHERE t.user_id = p_user_id AND t.period = v_period
      RETURNING t.* INTO v_row;
  ELSE
    UPDATE public.ai_usage AS t SET photo_count = t.photo_count + 1, updated_at = now()
      WHERE t.user_id = p_user_id AND t.period = v_period
      RETURNING t.* INTO v_row;
  END IF;

  RETURN QUERY SELECT true, v_row.msg_count, v_row.photo_count, 0, 0;
END;
$$;

-- 画面の表示用。回数の上限の代わりに、今週使ったトークンと枠を返す。戻り値の形が変わるので作り直す
DROP FUNCTION IF EXISTS public.get_ai_usage();
CREATE FUNCTION public.get_ai_usage()
RETURNS TABLE(msg_count INTEGER, photo_count INTEGER, token_count BIGINT, token_limit BIGINT, is_pro BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro BOOLEAN;
  v_row public.ai_usage%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_pro := public.is_pro_user(auth.uid());
  SELECT * INTO v_row FROM public.ai_usage
  WHERE user_id = auth.uid() AND period = to_char(now(), 'IYYY-"W"IW');

  RETURN QUERY SELECT
    COALESCE(v_row.msg_count, 0),
    COALESCE(v_row.photo_count, 0),
    COALESCE(v_row.token_count, 0),
    CASE WHEN v_pro THEN public.ai_weekly_token_limit() ELSE 0::BIGINT END,
    v_pro;
END;
$$;

-- ai-coach が応答に添える今週の利用量。本人以外の行を読めるので service_role だけに渡す
CREATE OR REPLACE FUNCTION public.ai_token_usage(p_user_id UUID)
RETURNS TABLE(token_count BIGINT, token_limit BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT u.token_count FROM public.ai_usage u
      WHERE u.user_id = p_user_id AND u.period = to_char(now(), 'IYYY-"W"IW')
    ), 0),
    public.ai_weekly_token_limit();
$$;

-- 呼ぶのは上の定義者関数だけ（所有者の権限で動く）なので、クライアントには渡さない
REVOKE ALL ON FUNCTION public.ai_weekly_token_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_weekly_token_limit() TO service_role;
REVOKE ALL ON FUNCTION public.reserve_ai_tokens(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_tokens(UUID, UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.consume_ai_usage(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.get_ai_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_usage() TO authenticated;
REVOKE ALL ON FUNCTION public.ai_token_usage(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_token_usage(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
