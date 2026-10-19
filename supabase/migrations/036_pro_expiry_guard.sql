-- =============================================================
-- Migration 036: 期限切れの Pro を tier 判定で落とす
--
-- subscriptions.expires_at は 019 から書き込んでいるが、どこからも読んで
-- いなかった。Pro かどうかの判定はすべて profiles.tier だけを見ているため、
-- EXPIRATION の Webhook を取りこぼすと Pro が永久に残る。
--
-- 判定を is_pro_user() に集約し、
--   ・profiles.tier = 'pro' であること（これまでどおり正本）
--   ・subscriptions.expires_at が切れていないこと（新しい条件）
-- の両方を満たすときだけ Pro とする。
--
-- 猶予を3日置くのは、RENEWAL の遅延や再送で「課金し続けている人」を誤って
-- Free に落とさないため。取りこぼしを拾うのが目的で、締め付けが目的ではない。
-- subscriptions 行が無い場合（Webhook 到達前・手動付与）は expires_at で
-- 判断できないので、これまでどおり profiles.tier に従う。
-- =============================================================

CREATE OR REPLACE FUNCTION public.is_pro_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.subscriptions s ON s.user_id = p.id
    WHERE p.id = p_user_id
      AND p.tier = 'pro'
      AND (
        s.user_id IS NULL
        OR s.expires_at IS NULL
        OR s.expires_at > now() - interval '3 days'
      )
  );
$$;

-- RLS ポリシーから呼ぶので authenticated にも EXECUTE が要る。
-- SECURITY DEFINER だが、引数のユーザーが Pro かどうかを返すだけで
-- 他人の情報は漏れない（tier は公開情報に近く、書き換えもできない）
REVOKE ALL ON FUNCTION public.is_pro_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pro_user(UUID) TO authenticated, service_role;

-- ─── AI利用枠：035 の tier 判定を is_pro_user() に差し替える ───
CREATE OR REPLACE FUNCTION public.get_ai_usage()
RETURNS TABLE(msg_count INTEGER, photo_count INTEGER, msg_limit INTEGER, photo_limit INTEGER, is_pro BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pro    BOOLEAN;
  v_period TEXT;
  v_row    public.ai_usage%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  v_pro    := public.is_pro_user(auth.uid());
  v_period := to_char(now(), 'IYYY-"W"IW');
  SELECT * INTO v_row FROM public.ai_usage WHERE user_id = auth.uid() AND period = v_period;

  RETURN QUERY SELECT
    COALESCE(v_row.msg_count, 0),
    COALESCE(v_row.photo_count, 0),
    CASE WHEN v_pro THEN 30 ELSE 0 END,
    CASE WHEN v_pro THEN 5  ELSE 0 END,
    v_pro;
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
  v_pro         BOOLEAN;
  v_msg_limit   INTEGER;
  v_photo_limit INTEGER;
  v_row         public.ai_usage%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('msg', 'photo') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  v_pro         := public.is_pro_user(p_user_id);
  v_period      := to_char(now(), 'IYYY-"W"IW');
  v_msg_limit   := CASE WHEN v_pro THEN 30 ELSE 0 END;
  v_photo_limit := CASE WHEN v_pro THEN 5  ELSE 0 END;

  -- 枠が 0 のティアはカウント行を作らずに弾く（035 と同じ理由）
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

-- ─── 自動バックアップ：025 のポリシーも同じ判定に揃える ───
-- SELECT / DELETE を絞らないのは 025 と同じ（預けた世代は本人のもの）
DROP POLICY IF EXISTS "backups_insert" ON public.backups;
CREATE POLICY "backups_insert" ON public.backups
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_pro_user(auth.uid())
  );

REVOKE EXECUTE ON FUNCTION public.get_ai_usage() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ai_usage() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) TO service_role;

-- ─── カスタム公開ページ：014 のポリシーも同じ判定に揃える ───
DROP POLICY IF EXISTS page_config_insert ON public.public_page_config;
CREATE POLICY page_config_insert ON public.public_page_config
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.desks d
      WHERE d.id = desk_id AND d.user_id = auth.uid()
    )
    AND public.is_pro_user(auth.uid())
  );

DROP POLICY IF EXISTS page_config_update ON public.public_page_config;
CREATE POLICY page_config_update ON public.public_page_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.desks d
      WHERE d.id = desk_id AND d.user_id = auth.uid()
    )
    AND public.is_pro_user(auth.uid())
  );

NOTIFY pgrst, 'reload schema';
