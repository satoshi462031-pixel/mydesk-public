-- =============================================================
-- Migration 035: AIコーチをProプラン限定にする
--
-- 032 では Free にも週3メッセージ・週1枚の枠を配っていた。これを 0 にして、
-- AI機能そのものを課金者限定にする。
--
--   Free : 週3メッセージ・週1枚  →  0（利用不可）
--   Pro  : 週30メッセージ・週5枚（変更なし）
--
-- 上限判定の正本はここ。クライアント（useAIUsageLimit / PLAN_LIMITS）の値は
-- サーバーから取れるまでのフォールバックでしかないので、アプリを更新していない
-- 端末から呼ばれても consume_ai_usage が false を返して弾く。
--
-- ai_usage の既存行はそのまま残す（履歴として意味があり、上限が 0 になれば
-- カウントの値に関わらず allowed=false になるため消す必要がない）。
-- =============================================================

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
  v_period := to_char(now(), 'IYYY-"W"IW');
  SELECT * INTO v_row FROM public.ai_usage WHERE user_id = auth.uid() AND period = v_period;

  RETURN QUERY SELECT
    COALESCE(v_row.msg_count, 0),
    COALESCE(v_row.photo_count, 0),
    CASE WHEN v_tier = 'pro' THEN 30 ELSE 0 END,
    CASE WHEN v_tier = 'pro' THEN 5  ELSE 0 END,
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
  v_period      := to_char(now(), 'IYYY-"W"IW');
  v_msg_limit   := CASE WHEN v_tier = 'pro' THEN 30 ELSE 0 END;
  v_photo_limit := CASE WHEN v_tier = 'pro' THEN 5  ELSE 0 END;

  -- 枠が 0 のティアはカウント行を作らずに弾く。
  -- Free の分まで行を作ると ai_usage が使いもしないユーザーで膨らむ
  IF (p_kind = 'msg' AND v_msg_limit <= 0) OR (p_kind = 'photo' AND v_photo_limit <= 0) THEN
    RETURN QUERY SELECT false, 0, 0, v_msg_limit, v_photo_limit;
    RETURN;
  END IF;

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
    UPDATE public.ai_usage AS t SET msg_count = t.msg_count + 1, updated_at = now()
      WHERE t.user_id = p_user_id AND t.period = v_period
      RETURNING t.* INTO v_row;
  ELSE
    IF v_row.photo_count >= v_photo_limit THEN
      RETURN QUERY SELECT false, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
      RETURN;
    END IF;
    UPDATE public.ai_usage AS t SET photo_count = t.photo_count + 1, updated_at = now()
      WHERE t.user_id = p_user_id AND t.period = v_period
      RETURNING t.* INTO v_row;
  END IF;

  RETURN QUERY SELECT true, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
END;
$$;

-- CREATE OR REPLACE で権限は維持されるが、032 と同じく明示しておく
REVOKE EXECUTE ON FUNCTION public.get_ai_usage() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_usage() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
