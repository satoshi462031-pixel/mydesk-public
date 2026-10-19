-- =============================================================
-- 044_gadget_insight_gate_fix.sql
--   043 の censor_exact_ok が「観測0件」でも true になっていた問題を直す。
--
--   censor_unknown（継続中なのに最終観測日時を確定できない観測の数）が 0 かどうか
--   だけで判定していたため、期間の展開結果が空（＝ version 2 以降の公開デスクが
--   1件も無い状態）でも条件を満たしたように見えていた。
--   実際 2026-08-29 時点の本番は全デスクが version 1 で、観測0件のまま ○ が出た。
--
--   「データが無い」と「条件を満たした」を同じ表示にすると、母数が育ったか
--   確認するための画面としては機能しない。観測が1件以上あることを条件に加える。
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_gadget_data_quality()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_desks    JSONB;
  v_snapshot JSONB;
  v_periods  JSONB;
  v_devices  JSONB;
  v_owners   INTEGER;
  v_public   INTEGER;
BEGIN
  SELECT jsonb_build_object(
    'public_desks',  COUNT(*),
    'unique_owners', COUNT(DISTINCT user_id)
  ) INTO v_desks
  FROM desks WHERE visibility = 'public';

  v_owners := COALESCE((v_desks->>'unique_owners')::INTEGER, 0);
  v_public := COALESCE((v_desks->>'public_desks')::INTEGER, 0);

  SELECT jsonb_build_object(
    'with_snapshot',  COUNT(*) FILTER (WHERE share_snapshot ? 'gadgets'),
    'empty_snapshot', COUNT(*) FILTER (WHERE NOT (share_snapshot ? 'gadgets')),
    'version_1',      COUNT(*) FILTER (WHERE share_snapshot->>'version' = '1'),
    'version_2_plus', COUNT(*) FILTER (
                        WHERE share_snapshot->>'version' ~ '^\d+$'
                          AND (share_snapshot->>'version')::INTEGER >= 2),
    'version_3_plus', COUNT(*) FILTER (
                        WHERE share_snapshot->>'version' ~ '^\d+$'
                          AND (share_snapshot->>'version')::INTEGER >= 3),
    -- これがあるデスクだけ、継続中期間の最終観測日時を確定できる
    'with_captured_at', COUNT(*) FILTER (
                        WHERE share_snapshot->>'snapshotCapturedAt' ~ '^\d{4}-\d{2}-\d{2}'),
    'plan_updated_at_missing', COUNT(*) FILTER (
                        WHERE share_snapshot ? 'gadgets'
                          AND COALESCE(share_snapshot->'plan'->>'updatedAt', '') !~ '^\d{4}-\d{2}-\d{2}')
  ) INTO v_snapshot
  FROM desks WHERE visibility = 'public';

  SELECT jsonb_build_object(
    'gadgets',            COUNT(DISTINCT (desk_id::TEXT || ':' || gadget_id)),
    'with_product_id',    COUNT(DISTINCT (desk_id::TEXT || ':' || gadget_id))
                            FILTER (WHERE product_id IS NOT NULL),
    'periods_total',      COUNT(*),
    'active_periods',     COUNT(*) FILTER (WHERE mode = 'active'),
    'decor_periods',      COUNT(*) FILTER (WHERE mode = 'decor'),
    'ended_active',       COUNT(*) FILTER (WHERE mode = 'active' AND ended_at IS NOT NULL AND NOT is_anomaly),
    'ongoing_active',     COUNT(*) FILTER (WHERE mode = 'active' AND ended_at IS NULL AND NOT is_anomaly),
    'reintroduced',       COUNT(*) FILTER (WHERE period_index > 1),
    'anomalies',          COUNT(*) FILTER (WHERE is_anomaly),
    'km_usable_periods',  COUNT(*) FILTER (WHERE mode = 'active' AND NOT is_anomaly AND period_index = 1),
    'km_unique_owners',   COUNT(DISTINCT user_id) FILTER (WHERE mode = 'active' AND NOT is_anomaly AND period_index = 1),
    'censor_unknown',     COUNT(*) FILTER (
                            WHERE mode = 'active' AND NOT is_anomaly AND period_index = 1
                              AND ended_at IS NULL AND censor_captured IS NULL),
    'desks_with_removal', COUNT(DISTINCT desk_id) FILTER (WHERE mode = 'active' AND ended_at IS NOT NULL AND NOT is_anomaly),
    'ended_at_auto',      COUNT(*) FILTER (WHERE ended_at IS NOT NULL AND ended_at_source = 'auto'),
    'ended_at_manual',    COUNT(*) FILTER (WHERE ended_at IS NOT NULL AND ended_at_source = 'manual')
  ) INTO v_periods
  FROM _public_desk_usage_periods();

  SELECT jsonb_build_object(
    'devices',             COUNT(*),
    'devices_no_cable',    COUNT(*) FILTER (WHERE d.category IS DISTINCT FROM 'Cable'),
    'null_category',       COUNT(*) FILTER (WHERE d.category IS NULL OR d.category = ''),
    'purchased_at_filled', COUNT(*) FILTER (WHERE d.purchased_at IS NOT NULL),
    'removed_at_filled',   COUNT(*) FILTER (WHERE d.removed_at IS NOT NULL),
    'price_filled',        COUNT(*) FILTER (WHERE d.price IS NOT NULL AND d.price > 0),
    'price_median',        ROUND(percentile_cont(0.50) WITHIN GROUP (
                             ORDER BY NULLIF(GREATEST(d.price, 0), 0))::NUMERIC)
  ) INTO v_devices
  FROM devices d
  JOIN desks k ON k.id = d.desk_id AND k.visibility = 'public';

  RETURN jsonb_build_object(
    'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'min_sample',   MIN_SAMPLE,
    'population',   v_desks,
    'snapshot',     v_snapshot,
    'periods',      v_periods,
    'devices',      v_devices,
    'categories', (
      SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'devices')::INTEGER DESC), '[]'::JSONB) FROM (
        SELECT jsonb_build_object(
          'category', d.category,
          'devices',  COUNT(*),
          'owners',   COUNT(DISTINCT k.user_id)
        ) AS row
        FROM devices d
        JOIN desks k ON k.id = d.desk_id AND k.visibility = 'public'
        WHERE d.category IS DISTINCT FROM 'Cable'
        GROUP BY d.category
      ) t
    ),
    'connections', (
      SELECT jsonb_build_object(
        'total',       COUNT(*),
        'self_link',   COUNT(*) FILTER (WHERE c.from_device_id = c.to_device_id),
        'cable_types', COUNT(DISTINCT c.cable_type)
      )
      FROM connections c
      JOIN desks k ON k.id = c.desk_id AND k.visibility = 'public'
    ),
    'gates', jsonb_build_object(
      'owners_ok',       v_owners >= MIN_SAMPLE,
      'owners_short_by', GREATEST(MIN_SAMPLE - v_owners, 0),
      'snapshot_v2_ok',  COALESCE((v_snapshot->>'version_2_plus')::INTEGER, 0) > 0
                           AND COALESCE((v_snapshot->>'version_2_plus')::INTEGER, 0) * 2 >= v_public,
      'events_ok',       COALESCE((v_periods->>'ended_active')::INTEGER, 0) > 0,
      'km_owners_ok',    COALESCE((v_periods->>'km_unique_owners')::INTEGER, 0) >= MIN_SAMPLE,
      -- ★ 043 からの変更点：観測が1件以上あることを条件に加える。
      --    censor_unknown = 0 だけだと、期間が1件も展開されていない状態
      --    （version 2 以降の公開デスクが無い）でも true になっていた。
      'censor_exact_ok', COALESCE((v_periods->>'km_usable_periods')::INTEGER, 0) > 0
                           AND COALESCE((v_periods->>'censor_unknown')::INTEGER, 0) = 0
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_gadget_data_quality() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gadget_data_quality() TO service_role;

NOTIFY pgrst, 'reload schema';
