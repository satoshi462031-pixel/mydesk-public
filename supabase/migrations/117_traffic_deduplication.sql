ALTER TABLE public.desk_daily_traffic
  ADD COLUMN filtered_web_views INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN filtered_app_views INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN filtered_shop_opens INTEGER NOT NULL DEFAULT 0;
CREATE TABLE account_security.traffic_deduplication (
  desk_id UUID NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (desk_id, kind, actor_key)
);
CREATE INDEX traffic_deduplication_time_idx ON account_security.traffic_deduplication(counted_at);
ALTER TABLE account_security.traffic_deduplication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security.traffic_deduplication FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.bump_desk_traffic(p_desk_id UUID, p_kind TEXT, p_actor_key TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_day DATE := (statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::DATE;
  v_now TIMESTAMPTZ := statement_timestamp();
  v_filtered BOOLEAN := false;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('web_view', 'app_view', 'shop_open') OR NOT EXISTS (
    SELECT 1 FROM public.desks WHERE id = p_desk_id AND visibility IN ('public', 'unlisted')
      AND (auth.uid() IS NULL OR user_id <> auth.uid())
  ) THEN RETURN; END IF;
  IF p_actor_key ~ '^[0-9a-f]{64}$' THEN
    INSERT INTO account_security.traffic_deduplication(desk_id, kind, actor_key, counted_at)
    VALUES (p_desk_id, p_kind, p_actor_key, v_now)
    ON CONFLICT (desk_id, kind, actor_key) DO UPDATE SET counted_at = EXCLUDED.counted_at
      WHERE traffic_deduplication.counted_at <= v_now - INTERVAL '5 minutes';
    v_filtered := FOUND;
  END IF;
  INSERT INTO public.desk_daily_traffic AS t
    (desk_id, day, web_views, app_views, shop_opens, filtered_web_views, filtered_app_views, filtered_shop_opens)
  VALUES (p_desk_id, v_day, (p_kind = 'web_view')::int, (p_kind = 'app_view')::int, (p_kind = 'shop_open')::int,
    (v_filtered AND p_kind = 'web_view')::int, (v_filtered AND p_kind = 'app_view')::int, (v_filtered AND p_kind = 'shop_open')::int)
  ON CONFLICT (desk_id, day) DO UPDATE SET
    web_views = LEAST(t.web_views::bigint + EXCLUDED.web_views, 2147483647)::int,
    app_views = LEAST(t.app_views::bigint + EXCLUDED.app_views, 2147483647)::int,
    shop_opens = LEAST(t.shop_opens::bigint + EXCLUDED.shop_opens, 2147483647)::int,
    filtered_web_views = LEAST(t.filtered_web_views::bigint + EXCLUDED.filtered_web_views, 2147483647)::int,
    filtered_app_views = LEAST(t.filtered_app_views::bigint + EXCLUDED.filtered_app_views, 2147483647)::int,
    filtered_shop_opens = LEAST(t.filtered_shop_opens::bigint + EXCLUDED.filtered_shop_opens, 2147483647)::int;
END;
$$;
DROP FUNCTION public.bump_desk_traffic(UUID, TEXT);
REVOKE ALL ON FUNCTION public.bump_desk_traffic(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_desk_traffic(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.record_desk_app_traffic(p_desk_id UUID, p_kind TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key TEXT; v_salt TEXT;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('app_view', 'shop_open') THEN RETURN; END IF;
  PERFORM public.check_account_access();
  IF auth.uid() IS NOT NULL THEN
    SELECT secret_hash INTO v_salt FROM account_security.public_api_gateway WHERE singleton;
    IF v_salt IS NOT NULL THEN
      v_key := encode(sha256(convert_to(v_salt || ':' || auth.uid()::text || ':' ||
        (statement_timestamp() AT TIME ZONE 'UTC')::date::text, 'UTF8')), 'hex');
    END IF;
  ELSE
    v_key := nullif(current_setting('request.headers', true), '')::jsonb->>'x-traffic-key';
  END IF;
  PERFORM public.bump_desk_traffic(p_desk_id, p_kind, v_key);
END;
$$;
REVOKE ALL ON FUNCTION public.record_desk_app_traffic(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_desk_app_traffic(UUID, TEXT) TO anon, authenticated;

CREATE FUNCTION public.prune_traffic_deduplication()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM account_security.traffic_deduplication WHERE counted_at < statement_timestamp() - INTERVAL '10 minutes';
$$;
REVOKE ALL ON FUNCTION public.prune_traffic_deduplication() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_traffic_deduplication() TO service_role;
CREATE OR REPLACE FUNCTION account_security.desk_traffic_summary(p_days INTEGER, p_filtered BOOLEAN)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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
    SELECT desk_id, day, CASE WHEN p_filtered THEN filtered_web_views ELSE web_views END AS web_views, CASE WHEN p_filtered THEN filtered_app_views ELSE app_views END AS app_views, CASE WHEN p_filtered THEN filtered_shop_opens ELSE shop_opens END AS shop_opens FROM public.desk_daily_traffic WHERE day >= (SELECT day FROM since)
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
        JOIN public.desks d ON d.id = r.desk_id
        GROUP BY d.id, d.visibility, d.title
        ORDER BY sum(r.web_views + r.app_views) DESC
        LIMIT 20
      ) top
    )
  );
$fn$;
REVOKE ALL ON FUNCTION account_security.desk_traffic_summary(INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.admin_desk_traffic(p_days INTEGER DEFAULT 30)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT account_security.desk_traffic_summary(p_days, false) || jsonb_build_object(
    'filtered', account_security.desk_traffic_summary(p_days, true)
  );
$$;
REVOKE ALL ON FUNCTION public.admin_desk_traffic(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_desk_traffic(INTEGER) TO service_role;
NOTIFY pgrst, 'reload schema';
