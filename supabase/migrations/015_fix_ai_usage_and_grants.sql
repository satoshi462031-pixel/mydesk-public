-- =============================================================
-- Migration 015: consume_ai_usage() のバグ修正 + 権限の抜け穴修正
--
-- 1) consume_ai_usage() 内の UPDATE 文で「msg_count」「photo_count」が
--    RETURNS TABLE の OUT パラメータ名と衝突し、常に
--    "column reference is ambiguous" エラーで失敗していた
--    （AIコーチが常に「使用回数の確認に失敗しました」になる原因）。
--
-- 2) Supabase プロジェクトは public スキーマの関数に対して
--    ALTER DEFAULT PRIVILEGES で anon / authenticated / service_role に
--    自動的に EXECUTE を付与する設定になっている（pg_default_acl で確認済み）。
--    そのため "REVOKE ALL ... FROM PUBLIC" だけでは anon / authenticated に
--    直接付与された EXECUTE 権限は消えず、service_role 専用のつもりだった
--    update_user_tier() / consume_ai_usage() / refund_ai_usage() を
--    クライアントが直接 RPC 呼び出しできてしまっていた
--    （014で意図した制限が実際には効いていなかった）。
-- =============================================================

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

-- ─── 権限の抜け穴修正 ───────────────────────────────────────────
-- anon / authenticated への default privilege 由来の EXECUTE を明示的に剥がす。
REVOKE EXECUTE ON FUNCTION public.update_user_tier(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_ai_usage(UUID, TEXT) FROM anon, authenticated;

-- get_ai_usage は authenticated が使う想定なので authenticated は残し、anon のみ剥がす
REVOKE EXECUTE ON FUNCTION public.get_ai_usage() FROM anon;

-- publish系はクライアント(authenticated)が呼ぶ想定なので authenticated は残し、anon のみ剥がす
-- （内部で auth.uid() による所有権チェックがあるため anon が呼んでも失敗するが、念のため最小権限にする）
REVOKE EXECUTE ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.replace_published_desk_content(UUID, JSONB, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.replace_desk_photos(UUID, JSONB) FROM anon;

NOTIFY pgrst, 'reload schema';
