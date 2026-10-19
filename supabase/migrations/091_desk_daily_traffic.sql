-- =============================================================
-- Migration 091: 公開デスクの閲覧数・購入リンクを開いた数（日別の件数だけ）
--
-- PostHog は利用者が有効にしたときだけ送る（初期オプトアウト）ため、共有の価値を測る
-- 閲覧数・クリック数がほとんど欠ける。共有リンクをアプリ外（worker の /d/:id）で
-- 開いた数は、そもそも PostHog に載る経路が無い。
--
-- そこで「どのデスクが、どの日に、何回」だけを数える。見た人・押した人の ID・端末・IP は
-- 受け取らず保存もしないので、個人に結びつかない統計として同意なしで取れる。
-- 同じ人が開き直した分も重ねて数える（重複を除くには人を識別する必要があり、それをしないのが前提）。
--
-- 利用者には出さない（運営の /admin/community だけで見る）。回数を人に見せると
-- anon から叩ける記録 RPC で水増しする動機が生まれる。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.desk_daily_traffic (
  desk_id    UUID    NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE,
  -- 日の区切りは日本時間（088 の集計と揃える）
  day        DATE    NOT NULL,
  web_views  INTEGER NOT NULL DEFAULT 0,
  app_views  INTEGER NOT NULL DEFAULT 0,
  shop_opens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (desk_id, day)
);

CREATE INDEX IF NOT EXISTS desk_daily_traffic_day_idx ON public.desk_daily_traffic (day);

-- ポリシーは作らない。読み書きは下の SECURITY DEFINER 関数だけから行う
ALTER TABLE public.desk_daily_traffic ENABLE ROW LEVEL SECURITY;

-- ─── 記録（共通）───────────────────────────────────────────
-- 公開・URL限定のデスクだけ数える。持ち主が自分のデスクを開いた分は数えない
-- （auth.uid() と比べるだけで、uid は保存しない）。
CREATE OR REPLACE FUNCTION public.bump_desk_traffic(p_desk_id UUID, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'Asia/Tokyo')::DATE;
BEGIN
  IF p_kind NOT IN ('web_view', 'app_view', 'shop_open') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.desks d
    WHERE d.id = p_desk_id
      AND d.visibility IN ('public', 'unlisted')
      AND (auth.uid() IS NULL OR d.user_id <> auth.uid())
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.desk_daily_traffic AS t (desk_id, day, web_views, app_views, shop_opens)
  VALUES (
    p_desk_id, v_day,
    (p_kind = 'web_view')::INT,
    (p_kind = 'app_view')::INT,
    (p_kind = 'shop_open')::INT
  )
  ON CONFLICT (desk_id, day) DO UPDATE SET
    web_views  = t.web_views  + EXCLUDED.web_views,
    app_views  = t.app_views  + EXCLUDED.app_views,
    shop_opens = t.shop_opens + EXCLUDED.shop_opens;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_desk_traffic(UUID, TEXT) FROM PUBLIC;
-- anon / authenticated には直接渡さない。Web の閲覧を名乗れないよう入口を分ける
GRANT EXECUTE ON FUNCTION public.bump_desk_traffic(UUID, TEXT) TO service_role;

-- ─── アプリから（閲覧・購入リンク）────────────────────────────
-- 共有リンクから未ログインで開く人もいるので anon にも渡す
CREATE OR REPLACE FUNCTION public.record_desk_app_traffic(p_desk_id UUID, p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_kind IN ('app_view', 'shop_open') THEN
    PERFORM public.bump_desk_traffic(p_desk_id, p_kind);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_desk_app_traffic(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_desk_app_traffic(UUID, TEXT) TO anon, authenticated;

-- ─── 集計（/admin/community）────────────────────────────────
-- 088 と同じく service_role にだけ渡し、Worker が secret の鍵で叩く
CREATE OR REPLACE FUNCTION public.admin_desk_traffic(p_days INTEGER DEFAULT 30)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH
  params AS (
    SELECT CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END AS days
  ),
  today AS (
    SELECT (now() AT TIME ZONE 'Asia/Tokyo')::DATE AS day
  ),
  since AS (
    SELECT (SELECT day FROM today) - (SELECT days FROM params) + 1 AS day
  ),
  in_range AS (
    SELECT * FROM desk_daily_traffic WHERE day >= (SELECT day FROM since)
  ),
  day_series AS (
    SELECT generate_series((SELECT day FROM since), (SELECT day FROM today), INTERVAL '1 day')::DATE AS day
  )
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'web_views',  COALESCE(sum(web_views), 0),
        'app_views',  COALESCE(sum(app_views), 0),
        'shop_opens', COALESCE(sum(shop_opens), 0),
        'desks_viewed', count(DISTINCT desk_id) FILTER (WHERE web_views + app_views > 0)
      )
      FROM in_range
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'day', s.day,
        'web_views',  COALESCE(t.web_views, 0),
        'app_views',  COALESCE(t.app_views, 0),
        'shop_opens', COALESCE(t.shop_opens, 0)
      ) ORDER BY s.day), '[]'::JSONB)
      FROM day_series s
      LEFT JOIN (
        SELECT day, sum(web_views) AS web_views, sum(app_views) AS app_views, sum(shop_opens) AS shop_opens
        FROM in_range GROUP BY day
      ) t ON t.day = s.day
    ),
    -- 題名は公開されているものだけ出す（URL限定の題名は ID を知る人にしか見えない）
    'top_desks', (
      SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'views')::INT DESC), '[]'::JSONB)
      FROM (
        SELECT jsonb_build_object(
          'title', CASE WHEN d.visibility = 'public' THEN d.title ELSE '（URL限定）' END,
          'views', sum(r.web_views + r.app_views),
          'web_views', sum(r.web_views),
          'shop_opens', sum(r.shop_opens)
        ) AS item
        FROM in_range r
        JOIN desks d ON d.id = r.desk_id
        GROUP BY d.id, d.visibility, d.title
        ORDER BY sum(r.web_views + r.app_views) DESC
        LIMIT 20
      ) top
    )
  );
$fn$;

REVOKE ALL ON FUNCTION public.admin_desk_traffic(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_desk_traffic(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
