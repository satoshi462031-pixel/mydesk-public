-- RevenueCatの最新状態だけでなく、更新・解約・失効の時系列を監査可能にする。
-- クライアントへは公開せず、Webhookのservice_roleだけが書き込む。
CREATE TABLE IF NOT EXISTS public.subscription_events (
  event_id        TEXT        NOT NULL,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  environment     TEXT,
  product_id      TEXT,
  entitlement     TEXT,
  resulting_tier  TEXT        NOT NULL CHECK (resulting_tier IN ('free', 'pro')),
  expires_at      TIMESTAMPTZ,
  event_at        TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  apply_result    TEXT        NOT NULL CHECK (apply_result IN ('applied', 'duplicate', 'stale', 'unknown_user')),
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_user_event_at
  ON public.subscription_events (user_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_type_event_at
  ON public.subscription_events (event_type, event_at DESC);

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscription_events TO service_role;

COMMENT ON TABLE public.subscription_events IS
  'RevenueCat webhook event history for retention, churn, and audit reporting; service_role only.';
