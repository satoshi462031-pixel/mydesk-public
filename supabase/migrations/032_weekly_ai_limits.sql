-- =============================================================
-- Migration 018: AI利用枠を全ティア週次に統一し、上限を見直す
--
-- これまで Free は月次（YYYY-MM）、Pro は ISO週（IYYY-"W"IW）と
-- 期間の粒度が違った。Free の月次は使い切ったあと最大3週間なにも
-- できない期間が生まれ、再訪の動機が消えるため週次に揃える。
--
--   Free : 月5メッセージ・月3枚  →  週3メッセージ・週1枚
--   Pro  : 週50メッセージ・週5枚 →  週30メッセージ・週5枚
--
-- Pro の 50→30 は原価率の調整（月額¥590からストア手数料を引いた
-- 手取りに対し、上限まで使われると50回/週では割に合わない）。
--
-- 期間キーの形式が変わるため、Free ユーザーの当月分カウントは
-- この移行時点で一度リセットされる（ユーザー側に有利な方向）。
-- 旧 'YYYY-MM' 行は履歴としてそのまま残す。
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
    CASE WHEN v_tier = 'pro' THEN 30 ELSE 3 END,
    CASE WHEN v_tier = 'pro' THEN 5  ELSE 1 END,
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
  v_msg_limit   := CASE WHEN v_tier = 'pro' THEN 30 ELSE 3 END;
  v_photo_limit := CASE WHEN v_tier = 'pro' THEN 5  ELSE 1 END;

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

-- 返金も同じ期間キーを見ないと、消費した行と別の行を戻すことになる
CREATE OR REPLACE FUNCTION public.refund_ai_usage(p_user_id UUID, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
BEGIN
  IF p_kind NOT IN ('msg', 'photo') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  v_period := to_char(now(), 'IYYY-"W"IW');

  IF p_kind = 'msg' THEN
    UPDATE public.ai_usage SET msg_count = GREATEST(msg_count - 1, 0), updated_at = now()
      WHERE user_id = p_user_id AND period = v_period;
  ELSE
    UPDATE public.ai_usage SET photo_count = GREATEST(photo_count - 1, 0), updated_at = now()
      WHERE user_id = p_user_id AND period = v_period;
  END IF;
END;
$$;

-- 権限は 014 / 015 で設定済みだが、CREATE OR REPLACE 後も維持されることを明示しておく
REVOKE EXECUTE ON FUNCTION public.get_ai_usage() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_usage() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.refund_ai_usage(UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_ai_usage(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
