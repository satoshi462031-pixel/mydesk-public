-- =============================================================
-- Migration 002: 課金システム + 成長記録強化
-- Supabase Dashboard → SQL Editor に貼り付けて実行
-- =============================================================

-- ─── profiles に tier を追加 ──────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'free'
    CHECK (tier IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ;

-- ─── subscriptions テーブル ───────────────────────────────────
-- RevenueCat Webhook からのサーバーサイド更新で利用
-- クライアントの課金状態キャッシュとしても機能
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier            TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  rc_customer_id  TEXT,
  rc_product_id   TEXT,
  rc_entitlement  TEXT,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'expired', 'cancelled', 'grace_period')),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id)
);

-- ─── desk_versions に note と cover_url を追加 ────────────────
-- desk_versions = 成長記録（growth records）として利用
ALTER TABLE public.desk_versions
  ADD COLUMN IF NOT EXISTS note       TEXT,
  ADD COLUMN IF NOT EXISTS cover_url  TEXT;

-- version_name を note に統一したいが、後方互換のため両方保持

-- ─── public_page_config テーブル（Pro限定カスタム公開ページ） ──
CREATE TABLE IF NOT EXISTS public.public_page_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id        UUID NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE UNIQUE,
  accent_color   TEXT DEFAULT '#FF9900',
  show_prices    BOOLEAN DEFAULT true,
  show_wiring    BOOLEAN DEFAULT true,
  show_history   BOOLEAN DEFAULT true,
  custom_domain  TEXT,  -- 将来: カスタムドメイン
  og_title       TEXT,
  og_description TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── インデックス ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS desk_versions_desk_id_idx ON public.desk_versions(desk_id);
CREATE INDEX IF NOT EXISTS desk_versions_created_at_idx ON public.desk_versions(desk_id, created_at DESC);

-- ─── updated_at 自動更新トリガー ─────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER public_page_config_updated_at
  BEFORE UPDATE ON public.public_page_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS 有効化 ───────────────────────────────────────────────
ALTER TABLE public.subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_page_config ENABLE ROW LEVEL SECURITY;

-- subscriptions: 自分のレコードのみ操作可能
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY subscriptions_insert ON public.subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY subscriptions_update ON public.subscriptions
  FOR UPDATE USING (user_id = auth.uid());

-- public_page_config: desk所有者のみ編集。公開設定のdeskは全員読み取り可
CREATE POLICY page_config_select ON public.public_page_config
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.desks d
      WHERE d.id = desk_id
        AND (d.visibility = 'public' OR d.user_id = auth.uid())
    )
  );

CREATE POLICY page_config_insert ON public.public_page_config
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.desks d
      WHERE d.id = desk_id AND d.user_id = auth.uid()
    )
  );

CREATE POLICY page_config_update ON public.public_page_config
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.desks d
      WHERE d.id = desk_id AND d.user_id = auth.uid()
    )
  );

-- desk_versions: desk所有者と公開デスク閲覧者が読み取り可
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'desk_versions' AND policyname = 'versions_select'
  ) THEN
    CREATE POLICY versions_select ON public.desk_versions
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.desks d
          WHERE d.id = desk_id
            AND (d.visibility = 'public' OR d.user_id = auth.uid())
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'desk_versions' AND policyname = 'versions_insert'
  ) THEN
    CREATE POLICY versions_insert ON public.desk_versions
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.desks d
          WHERE d.id = desk_id AND d.user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ─── profiles tier 更新ヘルパー関数（Webhook用） ─────────────
-- RevenueCat Webhook から service_role で呼び出す
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
AS $$
BEGIN
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
