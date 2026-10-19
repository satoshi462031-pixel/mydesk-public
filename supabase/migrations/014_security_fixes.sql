-- =============================================================
-- Migration 014: セキュリティ修正まとめ
--   1) profiles.tier / tier_updated_at をクライアントから直接更新不可にする
--   2) update_user_tier() を service_role 専用に制限（現状 PUBLIC 実行可能だった）
--   3) subscriptions への直接 INSERT/UPDATE をクライアントから禁止（SELECTのみ）
--   4) public_page_config を Pro ユーザー限定に制限
--   5) desks.view_count / like_count をクライアントから直接更新不可にする
--   6) 公開デスクの devices/connections/photos を単一トランザクションで
--      置換する統合RPC（publish_desk_snapshot）を追加（TOCTOU対策）
--   7) AI利用枠の消費に失敗時の返金RPC（refund_ai_usage）を追加
-- =============================================================

-- ─── 1) profiles: tier 列の保護 ────────────────────────────────
-- session_user は SECURITY DEFINER 関数内でも呼び出し元のロールのまま
-- 変化しないため、update_user_tier() 経由（service_role）の更新だけを許可できる。
CREATE OR REPLACE FUNCTION public.protect_profile_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_user <> 'service_role' THEN
    NEW.tier := OLD.tier;
    NEW.tier_updated_at := OLD.tier_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_tier ON public.profiles;
CREATE TRIGGER profiles_protect_tier
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_tier();

-- ─── 2) update_user_tier(): service_role 専用に制限 ────────────
-- 元のマイグレーションに REVOKE/GRANT が無く、SECURITY DEFINER のため
-- 認証済みクライアントが直接 RPC 呼び出しで自分の tier を 'pro' にできた。
REVOKE ALL ON FUNCTION public.update_user_tier(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_tier(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ─── 3) subscriptions: クライアントの書き込みを禁止 ────────────
-- 本来 RevenueCat Webhook（service_role）→ update_user_tier() 経由のみで
-- 更新されるべきだが、INSERT/UPDATE ポリシーがあるため
-- クライアントが自分の行を tier='pro' で直接書き込めてしまっていた。
DROP POLICY IF EXISTS subscriptions_insert ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_update ON public.subscriptions;

-- ─── 4) public_page_config: Pro限定 ────────────────────────────
DROP POLICY IF EXISTS page_config_insert ON public.public_page_config;
CREATE POLICY page_config_insert ON public.public_page_config
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.desks d
      JOIN public.profiles p ON p.id = d.user_id
      WHERE d.id = desk_id AND d.user_id = auth.uid() AND p.tier = 'pro'
    )
  );

DROP POLICY IF EXISTS page_config_update ON public.public_page_config;
CREATE POLICY page_config_update ON public.public_page_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.desks d
      JOIN public.profiles p ON p.id = d.user_id
      WHERE d.id = desk_id AND d.user_id = auth.uid() AND p.tier = 'pro'
    )
  );

-- ─── 5) desks: view_count / like_count の保護 ──────────────────
-- increment_view_count() / sync_like_count() だけが更新できるよう、
-- トランザクションローカルのフラグを立てた呼び出しのみバイパスを許可する。
CREATE OR REPLACE FUNCTION public.protect_desk_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.bypass_counter_protection', true) IS DISTINCT FROM 'on' THEN
    NEW.view_count := OLD.view_count;
    NEW.like_count := OLD.like_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desks_protect_counters ON public.desks;
CREATE TRIGGER desks_protect_counters
  BEFORE UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.protect_desk_counters();

CREATE OR REPLACE FUNCTION public.increment_view_count(p_desk_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.bypass_counter_protection', 'on', true);
  UPDATE desks
  SET view_count = view_count + 1
  WHERE id = p_desk_id AND visibility = 'public';
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.bypass_counter_protection', 'on', true);
  IF TG_OP = 'INSERT' THEN
    UPDATE desks SET like_count = like_count + 1 WHERE id = NEW.desk_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE desks SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.desk_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ─── 6) 公開デスクの内容を単一トランザクションで置換する統合RPC ──
-- 従来は replace_published_desk_content() と replace_desk_photos() を
-- クライアントが2回に分けて呼んでいたため、片方だけ成功した中途半端な
-- 状態が公開ページ閲覧者に見えるリスク（TOCTOU）があった。
CREATE OR REPLACE FUNCTION public.publish_desk_snapshot(
  p_desk_id UUID,
  p_devices JSONB,
  p_connections JSONB,
  p_image_urls JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device JSONB;
  connection JSONB;
  image_url TEXT;
  new_device_id UUID;
  device_ids JSONB := '{}'::JSONB;
  sort_index INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desks WHERE id = p_desk_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'desk not found or not owned by current user';
  END IF;

  DELETE FROM connections WHERE desk_id = p_desk_id;
  DELETE FROM devices WHERE desk_id = p_desk_id;

  FOR device IN SELECT value FROM jsonb_array_elements(COALESCE(p_devices, '[]'::JSONB)) LOOP
    INSERT INTO devices (desk_id, name, category, price, ports, purchased_at, removed_at)
    VALUES (
      p_desk_id,
      device->>'name',
      device->>'category',
      NULLIF(device->>'price', '')::INTEGER,
      COALESCE(device->'ports', '[]'::JSONB),
      NULLIF(device->>'purchased_at', '')::DATE,
      NULLIF(device->>'removed_at', '')::DATE
    )
    RETURNING id INTO new_device_id;
    device_ids := device_ids || jsonb_build_object(device->>'local_id', new_device_id);
  END LOOP;

  FOR connection IN SELECT value FROM jsonb_array_elements(COALESCE(p_connections, '[]'::JSONB)) LOOP
    IF device_ids ? (connection->>'from_local_id') AND device_ids ? (connection->>'to_local_id') THEN
      INSERT INTO connections (desk_id, from_device_id, to_device_id, cable_type)
      VALUES (
        p_desk_id,
        (device_ids->>(connection->>'from_local_id'))::UUID,
        (device_ids->>(connection->>'to_local_id'))::UUID,
        connection->>'cable_type'
      );
    END IF;
  END LOOP;

  DELETE FROM desk_photos WHERE desk_id = p_desk_id;
  FOR image_url IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_image_urls, '[]'::JSONB)) LOOP
    INSERT INTO desk_photos (desk_id, image_url, sort_order) VALUES (p_desk_id, image_url, sort_index);
    sort_index := sort_index + 1;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB) TO authenticated;

-- ─── 7) AI利用枠の返金RPC ───────────────────────────────────────
-- consume_ai_usage() は Anthropic 呼び出し前に枠を消費するため、
-- Anthropic 側のエラー時に枠だけ溶けてしまう問題への対応。
-- Edge Function 側で呼び出しが失敗した場合にこの関数で1回分を戻す。
CREATE OR REPLACE FUNCTION public.refund_ai_usage(p_user_id UUID, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT;
  v_tier   TEXT;
BEGIN
  IF p_kind NOT IN ('msg', 'photo') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  SELECT tier INTO v_tier FROM public.profiles WHERE id = p_user_id;
  v_period := CASE WHEN v_tier = 'pro' THEN to_char(now(), 'IYYY-"W"IW') ELSE to_char(now(), 'YYYY-MM') END;

  IF p_kind = 'msg' THEN
    UPDATE public.ai_usage SET msg_count = GREATEST(msg_count - 1, 0), updated_at = now()
      WHERE user_id = p_user_id AND period = v_period;
  ELSE
    UPDATE public.ai_usage SET photo_count = GREATEST(photo_count - 1, 0), updated_at = now()
      WHERE user_id = p_user_id AND period = v_period;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_ai_usage(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refund_ai_usage(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
