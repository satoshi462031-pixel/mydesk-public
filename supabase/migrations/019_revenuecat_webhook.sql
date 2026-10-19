-- =============================================================
-- 019_revenuecat_webhook.sql
--   RevenueCat Webhook（supabase/functions/revenuecat-webhook）から
--   課金状態を反映するための RPC。
--
--   1) protect_profile_tier() の判定方法を修正する。
--      014 は session_user = 'service_role' なら tier の更新を許す作りだが、
--      PostgREST は authenticator で接続して SET ROLE service_role するため
--      session_user は 'authenticator' のまま変わらない。結果として
--      service_role 経由の update_user_tier() でも tier が巻き戻され、
--      profiles.tier が永久に 'free' のままになる。
--      014 が desks のカウンタ保護で使っているのと同じ
--      トランザクションローカルのフラグ方式に揃える。
--
--   2) apply_revenuecat_event() を追加する。update_user_tier() との違いは
--      「同じイベントの再送」と「イベントの到達順の入れ替わり」を弾くこと。
--      RevenueCat は 2xx が返るまで再送するため再送は必ず起きるし、
--      EXPIRATION が RENEWAL より後に届くと課金中のユーザーが free に
--      落ちてしまう。イベントIDと発生時刻を行に持たせて防ぐ。
-- =============================================================

-- ─── 1) tier 保護トリガーの判定を修正 ──────────────────────────
CREATE OR REPLACE FUNCTION public.protect_profile_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.bypass_tier_protection', true) IS DISTINCT FROM 'on' THEN
    NEW.tier := OLD.tier;
    NEW.tier_updated_at := OLD.tier_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

-- フラグはトランザクションローカル（set_config の第3引数 true）で、
-- 立てられるのは下の2つの SECURITY DEFINER 関数の中だけ。クライアントは
-- PostgREST 経由で pg_catalog.set_config を呼べず、RPC は1呼び出し＝1
-- トランザクションなので別リクエストからフラグを持ち込むこともできない。

-- ─── 既存の update_user_tier() にもフラグを追加 ────────────────
-- 呼び出し元は現状ないが、上のトリガー修正と対で直しておかないと
-- 「実行しても tier が変わらない関数」が残ってしまう。
CREATE OR REPLACE FUNCTION public.update_user_tier(
  p_user_id UUID,
  p_tier    TEXT,
  p_rc_customer_id TEXT DEFAULT NULL,
  p_rc_product_id  TEXT DEFAULT NULL,
  p_expires_at     TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.bypass_tier_protection', 'on', true);

  UPDATE public.profiles
  SET tier = p_tier, tier_updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.subscriptions (user_id, tier, rc_customer_id, rc_product_id, expires_at, status)
  VALUES (p_user_id, p_tier, p_rc_customer_id, p_rc_product_id, p_expires_at,
          CASE WHEN p_tier = 'pro' THEN 'active' ELSE 'expired' END)
  ON CONFLICT (user_id) DO UPDATE
  SET tier           = EXCLUDED.tier,
      rc_customer_id = COALESCE(EXCLUDED.rc_customer_id, subscriptions.rc_customer_id),
      rc_product_id  = EXCLUDED.rc_product_id,
      expires_at     = EXCLUDED.expires_at,
      status         = EXCLUDED.status,
      updated_at     = NOW();
END;
$$;

-- ─── 2) Webhook イベント適用用の列と RPC ───────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS rc_last_event_id TEXT,
  ADD COLUMN IF NOT EXISTS rc_last_event_at TIMESTAMPTZ;

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
-- 'applied' | 'duplicate' | 'stale' | 'unknown_user'
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.subscriptions%ROWTYPE;
BEGIN
  IF p_tier NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION 'invalid tier: %', p_tier;
  END IF;

  -- 退会済み・別プロジェクトのイベントなど、こちらに存在しないユーザー。
  -- 再送されても結果は変わらないので Webhook 側は 200 を返して打ち切る。
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN 'unknown_user';
  END IF;

  -- 同時に届いた2イベントが互いの判定を追い越さないよう行ロックを取る
  SELECT * INTO v_row FROM public.subscriptions WHERE user_id = p_user_id FOR UPDATE;

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
      rc_product_id    = COALESCE(EXCLUDED.rc_product_id,  subscriptions.rc_product_id),
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

-- ─── 権限：service_role（Webhook）専用 ─────────────────────────
-- Supabase は public スキーマの関数に anon / authenticated への EXECUTE を
-- 自動付与するため、FROM PUBLIC だけでは剥がれない（015 の教訓）。
REVOKE ALL ON FUNCTION public.apply_revenuecat_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_revenuecat_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_revenuecat_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.update_user_tier(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_tier(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_tier(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
