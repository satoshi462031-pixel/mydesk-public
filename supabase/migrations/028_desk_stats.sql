-- =============================================================
-- 028_desk_stats.sql — 公開デスク横断の集計統計
--
-- 母集団は visibility='public' のデスクのみ。devices / connections は
-- publish_desk_snapshot()（014）で公開時にまとめて書き込まれるため、
-- 非公開デスクの機器はそもそも DB に存在しない。
--
-- devices.created_at は publish のたびに DELETE→INSERT で作り直されるため
-- 「いつ追加されたか」の指標にはならない。時系列はユーザー入力の
-- purchased_at（006）を使う。
--
-- サンプル数が少ないうちに中央値やパーセンタイルを出すと数字が跳ねて
-- 誤解を招くため、MIN_SAMPLE 未満は ready=false を返し、呼び出し側で
-- 非表示にする。
-- =============================================================

-- ─── デスク総額の分布 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_desk_price_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_result JSONB;
BEGIN
  WITH pool AS (
    SELECT total_price AS p
    FROM desks
    WHERE visibility = 'public' AND total_price > 0
  )
  SELECT CASE
    WHEN COUNT(*) < MIN_SAMPLE THEN
      jsonb_build_object('ready', false, 'n', COUNT(*), 'min_sample', MIN_SAMPLE)
    ELSE
      jsonb_build_object(
        'ready',      true,
        'n',          COUNT(*),
        'min_sample', MIN_SAMPLE,
        'median',     ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY p)::NUMERIC),
        'p25',        ROUND(percentile_cont(0.25) WITHIN GROUP (ORDER BY p)::NUMERIC),
        'p75',        ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY p)::NUMERIC),
        'p90',        ROUND(percentile_cont(0.90) WITHIN GROUP (ORDER BY p)::NUMERIC),
        'mean',       ROUND(AVG(p)::NUMERIC)
      )
  END
  INTO v_result
  FROM pool;

  RETURN v_result;
END;
$$;

-- ─── 指定金額が上位何%か ──────────────────────────────────────
-- 「あなたのデスクは上位◯%」の表示用。自分の総額は端末側が持っているため
-- 引数で受け取る（デスクIDを渡させると非公開デスクの照会に使われうる）。
CREATE OR REPLACE FUNCTION public.get_desk_price_percentile(p_price INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_n      INTEGER;
  v_above  INTEGER;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'p_price must be a positive integer';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE total_price > p_price)
    INTO v_n, v_above
  FROM desks
  WHERE visibility = 'public' AND total_price > 0;

  IF v_n < MIN_SAMPLE THEN
    RETURN jsonb_build_object('ready', false, 'n', v_n, 'min_sample', MIN_SAMPLE);
  END IF;

  RETURN jsonb_build_object(
    'ready',      true,
    'n',          v_n,
    'min_sample', MIN_SAMPLE,
    -- 上位何%か（小さいほど高額）。1件も上に居なければ 0.1% で頭打ちにする。
    'top_percent', GREATEST(ROUND(v_above::NUMERIC * 100 / v_n, 1), 0.1)
  );
END;
$$;

-- ─── カテゴリ別の利用状況 ─────────────────────────────────────
-- 製品名単位の TOP5 は devices.name が自由入力で表記ゆれするため出せない。
-- product_id での名寄せが入るまではカテゴリ単位に留める。
-- 出力列名は SQL 関数内での列参照の曖昧さを避けるため元テーブルと変えている。
CREATE OR REPLACE FUNCTION public.get_category_stats()
RETURNS TABLE (
  category_key TEXT,
  device_count BIGINT,
  desk_count   BIGINT,
  median_price NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.category,
    COUNT(*),
    COUNT(DISTINCT d.desk_id),
    ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY d.price)::NUMERIC)
  FROM devices d
  JOIN desks k ON k.id = d.desk_id AND k.visibility = 'public'
  -- ケーブルはアプリ側の統計（GadgetStatsScreen）でも集計対象外
  WHERE d.category <> 'Cable'
  GROUP BY d.category
  HAVING COUNT(*) >= 10
  ORDER BY 2 DESC;
$$;

-- ─── 月別の導入台数 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_monthly_adoption(p_months INTEGER DEFAULT 6)
RETURNS TABLE (
  month_key    TEXT,
  category_key TEXT,
  device_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('month', d.purchased_at), 'YYYY-MM'),
    d.category,
    COUNT(*)
  FROM devices d
  JOIN desks k ON k.id = d.desk_id AND k.visibility = 'public'
  WHERE d.purchased_at IS NOT NULL
    AND d.category <> 'Cable'
    AND d.purchased_at >= date_trunc('month', now())
                          - ((GREATEST(1, LEAST(COALESCE(p_months, 6), 24)) - 1) * INTERVAL '1 month')
  GROUP BY 1, 2
  ORDER BY 1 DESC, 3 DESC;
$$;

-- ─── 権限 ─────────────────────────────────────────────────────
-- 集計対象は公開デスクのみだが、SECURITY DEFINER なので明示的に絞る。
REVOKE ALL ON FUNCTION public.get_desk_price_stats()               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_desk_price_percentile(INTEGER)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_category_stats()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_monthly_adoption(INTEGER)        FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_desk_price_stats()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_desk_price_percentile(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_stats()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_adoption(INTEGER)      TO authenticated;

-- ─── インデックス ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_desks_public_total_price
  ON desks (total_price) WHERE visibility = 'public';
CREATE INDEX IF NOT EXISTS idx_devices_category
  ON devices (category);
CREATE INDEX IF NOT EXISTS idx_devices_purchased_at
  ON devices (purchased_at) WHERE purchased_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
