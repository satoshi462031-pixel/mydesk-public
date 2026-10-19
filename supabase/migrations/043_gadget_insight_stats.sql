-- =============================================================
-- 043_gadget_insight_stats.sql — /admin 用のガジェット利用統計
--
-- 母集団は visibility='public' のデスクのみ。028 と同じ制約で、
-- 非公開デスクの機器はそもそも DB に存在しない。
--
-- 在籍期間の正本は devices ではなく desks.share_snapshot。
-- devices には publish 時点で selectedGadgetIds に残っている機器だけが入り
-- （publishService.ts の selectedGadgets）、デスクから外した機器は行ごと消えるため、
-- devices.removed_at では撤去イベントがほとんど観測できない。
-- share_snapshot(version>=2).gadgets[*].deskUsagePeriods には撤去済みを含む
-- 全機器の期間履歴と productId が入る。
--
-- 判定はすべてユニーク所有者数（desks.user_id）で行う。device 行数で判定すると
-- 1人が大量に登録しただけで閾値を超えてしまう。
-- =============================================================

-- ─── 共通：公開デスクの期間履歴を展開する ─────────────────────
-- 他の SECURITY DEFINER 関数からのみ呼ぶ内部関数。呼び出し元が定義者権限で
-- 動くため、anon/authenticated から実行権限を剥がしても内部呼び出しは通る。
CREATE OR REPLACE FUNCTION public._public_desk_usage_periods()
RETURNS TABLE (
  user_id        UUID,
  desk_id        UUID,
  gadget_id      TEXT,
  product_id     TEXT,
  category       TEXT,
  price          INTEGER,
  mode           TEXT,
  started_at     DATE,
  ended_at       DATE,
  period_index   INTEGER,
  ended_at_source TEXT,
  censor_captured DATE,
  censor_plan    DATE,
  censor_desk    DATE,
  is_anomaly     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH snap AS (
    SELECT
      k.user_id,
      k.id AS desk_id,
      k.share_snapshot AS snapshot,
      -- version 3 以降が持つスナップショット保存時刻。これがあるときだけ
      -- 「いつまで観測できていたか」を確定できる（＝公開可能な継続率を出せる）。
      CASE
        WHEN k.share_snapshot->>'snapshotCapturedAt' ~ '^\d{4}-\d{2}-\d{2}'
        THEN LEFT(k.share_snapshot->>'snapshotCapturedAt', 10)::DATE
      END AS censor_captured,
      -- 以下2つは version 2 までの代用。plan.updatedAt はプランの最終編集日時で
      -- あって publish 日時ではなく、編集せず再公開すると据え置かれる。
      CASE
        WHEN k.share_snapshot->'plan'->>'updatedAt' ~ '^\d{4}-\d{2}-\d{2}'
        THEN LEFT(k.share_snapshot->'plan'->>'updatedAt', 10)::DATE
      END AS censor_plan,
      k.updated_at::DATE AS censor_desk
    FROM desks k
    WHERE k.visibility = 'public'
      AND k.share_snapshot ? 'gadgets'
      AND k.share_snapshot->>'version' ~ '^\d+$'
      AND (k.share_snapshot->>'version')::INTEGER >= 2
  ),
  expanded AS (
    SELECT
      s.user_id,
      s.desk_id,
      g.item->>'id'        AS gadget_id,
      NULLIF(g.item->>'productId', '') AS product_id,
      g.item->>'category'  AS category,
      CASE WHEN g.item->>'price' ~ '^-?\d+$' THEN (g.item->>'price')::INTEGER END AS price,
      COALESCE(p.period->>'mode', 'active') AS mode,
      CASE WHEN p.period->>'startedAt' ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (p.period->>'startedAt')::DATE END AS started_at,
      CASE WHEN p.period->>'endedAt' ~ '^\d{4}-\d{2}-\d{2}$'
           THEN (p.period->>'endedAt')::DATE END AS ended_at,
      (p.ord)::INTEGER AS period_index,
      -- 自動で入る endedAt は「デスクから外した操作日」で、実際の撤去日ではない。
      -- 手入力と区別できないと event time に系統誤差が乗るため件数を出す
      COALESCE(p.period->>'endedAtSource', 'auto') AS ended_at_source,
      s.censor_captured,
      s.censor_plan,
      s.censor_desk
    FROM snap s
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.snapshot->'gadgets', '[]'::JSONB)) AS g(item)
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(g.item->'deskUsagePeriods', '[]'::JSONB))
      WITH ORDINALITY AS p(period, ord)
  )
  SELECT
    e.user_id, e.desk_id, e.gadget_id, e.product_id, e.category, e.price,
    e.mode, e.started_at, e.ended_at, e.period_index, e.ended_at_source,
    e.censor_captured, e.censor_plan, e.censor_desk,
    -- 異常値は落とさず印だけ付ける。除外件数を画面に出すため
    (
      e.started_at IS NULL
      OR e.started_at > CURRENT_DATE
      OR (e.ended_at IS NOT NULL AND e.ended_at < e.started_at)
      OR (e.ended_at IS NOT NULL AND e.ended_at > CURRENT_DATE)
      OR (e.ended_at IS NOT NULL AND e.ended_at - e.started_at > 365 * 20)
    ) AS is_anomaly
  FROM expanded e;
$fn$;

REVOKE ALL ON FUNCTION public._public_desk_usage_periods() FROM PUBLIC, anon, authenticated;

-- ─── 1. データ品質と母集団 ────────────────────────────────────
-- n が足りているかを判断するための数え上げ。推論を含まないので MIN_SAMPLE の
-- ゲートは掛けない（この関数自体が「まだ足りない」を伝える役目）。
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
    -- 継続中なのに最終観測日時を確定できない観測。0 になるまで継続率は公開できない
    'censor_unknown',     COUNT(*) FILTER (
                            WHERE mode = 'active' AND NOT is_anomaly AND period_index = 1
                              AND ended_at IS NULL AND censor_captured IS NULL),
    'desks_with_removal', COUNT(DISTINCT desk_id) FILTER (WHERE mode = 'active' AND ended_at IS NOT NULL AND NOT is_anomaly),
    -- 撤去日が操作日そのままの件数。多いほど event time の精度が低い
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
    -- 停止条件をサーバー側で判定して返す。画面側で条件を書き写さない
    'gates', jsonb_build_object(
      'owners_ok',       v_owners >= MIN_SAMPLE,
      'owners_short_by', GREATEST(MIN_SAMPLE - v_owners, 0),
      'snapshot_v2_ok',  COALESCE((v_snapshot->>'version_2_plus')::INTEGER, 0) > 0
                           AND COALESCE((v_snapshot->>'version_2_plus')::INTEGER, 0) * 2 >= v_public,
      'events_ok',       COALESCE((v_periods->>'ended_active')::INTEGER, 0) > 0,
      'km_owners_ok',    COALESCE((v_periods->>'km_unique_owners')::INTEGER, 0) >= MIN_SAMPLE,
      -- 継続率を公開できるのは、継続中の全観測に snapshotCapturedAt があるときだけ
      'censor_exact_ok', COALESCE((v_periods->>'censor_unknown')::INTEGER, 0) = 0
    )
  );
END;
$fn$;

-- ─── 2. 記録上の在籍継続率（カプラン・マイヤー）────────────────
-- 観測単位は初回 active 期間（period_index = 1）。複数期間の合算は KM に入れない。
-- p_censor_source は 'plan'（share_snapshot.plan.updatedAt）か 'desk'（desks.updated_at）。
-- どちらも正確な publish 日時ではないため、両方で計算して感度差を見る前提。
-- p_censor_source: 'captured'（既定・snapshotCapturedAt）/ 'plan' / 'desk'。
-- 'captured' だけが正確な最終観測日時で、他は version 2 以前のための代用。
CREATE OR REPLACE FUNCTION public.admin_gadget_tenure_by_category(p_censor_source TEXT DEFAULT 'captured')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_source TEXT := CASE
                     WHEN p_censor_source = 'desk' THEN 'desk'
                     WHEN p_censor_source = 'plan' THEN 'plan'
                     ELSE 'captured'
                   END;
  v_rows JSONB;
BEGIN
  WITH base AS (
    SELECT
      p.user_id, p.category, p.started_at, p.ended_at,
      CASE v_source
        WHEN 'desk' THEN p.censor_desk
        WHEN 'plan' THEN p.censor_plan
        ELSE p.censor_captured
      END AS censor_at,
      p.censor_captured
    FROM _public_desk_usage_periods() p
    WHERE p.mode = 'active'
      AND NOT p.is_anomaly
      AND p.period_index = 1
      AND p.category IS DISTINCT FROM 'Cable'
      AND p.category IS NOT NULL
  ),
  clean AS (
    SELECT
      category, user_id,
      CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END AS is_event,
      CASE
        WHEN ended_at IS NOT NULL THEN ended_at - started_at
        -- 打ち切り日は候補日と集計日の早いほう
        ELSE LEAST(censor_at, CURRENT_DATE) - started_at
      END AS days,
      -- 撤去済みの観測は打ち切り日に依存しない。継続中の観測だけが
      -- snapshotCapturedAt の有無に左右される
      (ended_at IS NOT NULL OR censor_captured IS NOT NULL) AS censor_exact
    FROM base
    -- 打ち切り日を確定できない継続中の観測は除外する（推測値で埋めない）
    WHERE ended_at IS NOT NULL OR censor_at IS NOT NULL
  ),
  valid AS (SELECT * FROM clean WHERE days >= 0),
  times AS (SELECT DISTINCT category, days AS t FROM valid WHERE is_event = 1),
  steps AS (
    SELECT
      tm.category, tm.t,
      -- 打ち切り観測も打ち切り時点まではリスク集合に含める（days >= t）
      (SELECT COUNT(*) FROM valid v WHERE v.category = tm.category AND v.days >= tm.t) AS n_i,
      (SELECT COUNT(*) FROM valid v WHERE v.category = tm.category AND v.days = tm.t AND v.is_event = 1) AS d_i
    FROM times tm
  ),
  surv AS (
    SELECT
      category, t, n_i, d_i,
      -- S(t) = Π (1 - d_i / n_i)。ln(0) は例外になるため下限で潰す（実質 0）
      EXP(SUM(LN(GREATEST(1 - d_i::NUMERIC / NULLIF(n_i, 0), 1e-12)))
          OVER (PARTITION BY category ORDER BY t ROWS UNBOUNDED PRECEDING)) AS s
    FROM steps
  ),
  agg AS (
    SELECT
      v.category,
      COUNT(*)                   AS observations,
      COUNT(DISTINCT v.user_id)  AS owners,
      SUM(v.is_event)            AS events,
      COUNT(*) - SUM(v.is_event) AS censored,
      COUNT(*) FILTER (WHERE v.censor_exact) AS exact_observations,
      (SELECT ROUND(s * 100, 1) FROM surv WHERE surv.category = v.category AND t <=  90 ORDER BY t DESC LIMIT 1) AS s90,
      (SELECT ROUND(s * 100, 1) FROM surv WHERE surv.category = v.category AND t <= 180 ORDER BY t DESC LIMIT 1) AS s180,
      (SELECT ROUND(s * 100, 1) FROM surv WHERE surv.category = v.category AND t <= 365 ORDER BY t DESC LIMIT 1) AS s365,
      (SELECT ROUND(s * 100, 1) FROM surv WHERE surv.category = v.category AND t <= 730 ORDER BY t DESC LIMIT 1) AS s730,
      (SELECT MIN(t) FROM surv WHERE surv.category = v.category AND s <= 0.5) AS median_days
    FROM valid v
    GROUP BY v.category
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category',     category,
      'ready',        owners >= MIN_SAMPLE,
      'owners',       CASE WHEN owners >= MIN_SAMPLE THEN owners END,
      'observations', CASE WHEN owners >= MIN_SAMPLE THEN observations END,
      'events',       CASE WHEN owners >= MIN_SAMPLE THEN events END,
      'censored',     CASE WHEN owners >= MIN_SAMPLE THEN censored END,
      -- 全観測の最終観測日時を確定できているか。false のあいだ、この行の
      -- 継続率は参考値であって公開できない
      'censor_exact', exact_observations = observations,
      'exact_ratio',  ROUND(exact_observations::NUMERIC / NULLIF(observations, 0), 3),
      -- イベントが1件も無い時点までは S(t)=100。COALESCE で前の時点へ落とす
      's90',          CASE WHEN owners >= MIN_SAMPLE THEN COALESCE(s90, 100) END,
      's180',         CASE WHEN owners >= MIN_SAMPLE THEN COALESCE(s180, s90, 100) END,
      's365',         CASE WHEN owners >= MIN_SAMPLE THEN COALESCE(s365, s180, s90, 100) END,
      's730',         CASE WHEN owners >= MIN_SAMPLE THEN COALESCE(s730, s365, s180, s90, 100) END,
      'median_days',  CASE WHEN owners >= MIN_SAMPLE THEN median_days END,
      'median_reached', median_days IS NOT NULL
    ) ORDER BY observations DESC
  ), '[]'::JSONB) INTO v_rows FROM agg;

  RETURN jsonb_build_object(
    'censor_source', v_source,
    'min_sample',    MIN_SAMPLE,
    'generated_at',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'excluded', (
      SELECT jsonb_build_object(
        'anomalies',      COUNT(*) FILTER (WHERE is_anomaly),
        'censor_unknown', COUNT(*) FILTER (
                            WHERE NOT is_anomaly AND mode = 'active' AND period_index = 1
                              AND ended_at IS NULL
                              AND (CASE v_source
                                     WHEN 'desk' THEN censor_desk
                                     WHEN 'plan' THEN censor_plan
                                     ELSE censor_captured
                                   END) IS NULL),
        'decor_periods',  COUNT(*) FILTER (WHERE mode = 'decor'),
        'reintroduced',   COUNT(*) FILTER (WHERE period_index > 1)
      ) FROM _public_desk_usage_periods()
    ),
    'rows', v_rows
  );
END;
$fn$;

-- ─── 3-A. 共在構成（同じ公開デスクに登録されている）─────────────
-- データ源は devices。connections（直接接続）とは別物なので混同しない。
CREATE OR REPLACE FUNCTION public.admin_gadget_cooccurrence()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_owners INTEGER;
  v_desks  INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id), COUNT(*) INTO v_owners, v_desks
  FROM desks WHERE visibility = 'public';

  IF v_owners < MIN_SAMPLE THEN
    RETURN jsonb_build_object('ready', false, 'min_sample', MIN_SAMPLE, 'owners', v_owners);
  END IF;

  RETURN jsonb_build_object(
    'ready', true, 'min_sample', MIN_SAMPLE, 'desks', v_desks, 'owners', v_owners,
    'rows', (
      WITH desk_cat AS (
        -- 同一デスクに同じカテゴリが複数台あっても1回だけ数える
        SELECT DISTINCT k.id AS desk_id, k.user_id, d.category
        FROM devices d
        JOIN desks k ON k.id = d.desk_id AND k.visibility = 'public'
        WHERE d.category IS DISTINCT FROM 'Cable' AND COALESCE(d.category, '') <> ''
      ),
      support AS (
        SELECT category, COUNT(*) AS desks FROM desk_cat GROUP BY category
      ),
      pairs AS (
        SELECT a.category AS cat_a, b.category AS cat_b,
               COUNT(*) AS both_desks, COUNT(DISTINCT a.user_id) AS both_owners
        FROM desk_cat a
        JOIN desk_cat b ON b.desk_id = a.desk_id AND b.category > a.category
        GROUP BY a.category, b.category
      )
      SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'both_desks')::INTEGER DESC), '[]'::JSONB) FROM (
        SELECT jsonb_build_object(
          'cat_a', p.cat_a, 'cat_b', p.cat_b,
          'support_a', sa.desks, 'support_b', sb.desks,
          'both_desks', p.both_desks, 'both_owners', p.both_owners,
          'confidence_b_given_a', ROUND(p.both_desks::NUMERIC / sa.desks * 100, 1),
          'confidence_a_given_b', ROUND(p.both_desks::NUMERIC / sb.desks * 100, 1),
          'lift', ROUND((p.both_desks::NUMERIC * v_desks) / (sa.desks::NUMERIC * sb.desks), 2)
        ) AS row
        FROM pairs p
        JOIN support sa ON sa.category = p.cat_a
        JOIN support sb ON sb.category = p.cat_b
        WHERE p.both_owners >= MIN_SAMPLE
      ) t
    )
  );
END;
$fn$;

-- ─── 3-B. 直接接続構成（connections で直接つながっている）───────
CREATE OR REPLACE FUNCTION public.admin_gadget_connections()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_owners INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_owners FROM desks WHERE visibility = 'public';

  IF v_owners < MIN_SAMPLE THEN
    RETURN jsonb_build_object('ready', false, 'min_sample', MIN_SAMPLE, 'owners', v_owners);
  END IF;

  RETURN jsonb_build_object(
    'ready', true, 'min_sample', MIN_SAMPLE, 'owners', v_owners,
    'rows', (
      WITH link AS (
        -- 無向として正規化する（A-B と B-A を同じペアにまとめる）
        SELECT
          k.id AS desk_id, k.user_id,
          LEAST(df.category, dt.category)    AS cat_a,
          GREATEST(df.category, dt.category) AS cat_b,
          COALESCE(c.cable_type, '(未設定)') AS cable_type
        FROM connections c
        JOIN desks k    ON k.id = c.desk_id AND k.visibility = 'public'
        JOIN devices df ON df.id = c.from_device_id
        JOIN devices dt ON dt.id = c.to_device_id
        WHERE c.from_device_id <> c.to_device_id
          AND df.category IS NOT NULL AND dt.category IS NOT NULL
      ),
      grouped AS (
        SELECT cat_a, cat_b,
               COUNT(*) AS links,
               COUNT(DISTINCT desk_id) AS desks,
               COUNT(DISTINCT user_id) AS owners
        FROM link GROUP BY cat_a, cat_b
        HAVING COUNT(DISTINCT user_id) >= MIN_SAMPLE
      )
      SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'links')::INTEGER DESC), '[]'::JSONB) FROM (
        SELECT jsonb_build_object(
          'cat_a', g.cat_a, 'cat_b', g.cat_b,
          'links', g.links, 'desks', g.desks, 'owners', g.owners,
          'cable_types', (
            SELECT jsonb_object_agg(l.cable_type, l.n) FROM (
              SELECT cable_type, COUNT(*) AS n FROM link
              WHERE link.cat_a = g.cat_a AND link.cat_b = g.cat_b
              GROUP BY cable_type
            ) l
          )
        ) AS row
        FROM grouped g
      ) t
    )
  );
END;
$fn$;

-- ─── 4. 価格帯と在籍期間 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_gadget_tenure_by_price_band(p_censor_source TEXT DEFAULT 'captured')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_source TEXT := CASE
                     WHEN p_censor_source = 'desk' THEN 'desk'
                     WHEN p_censor_source = 'plan' THEN 'plan'
                     ELSE 'captured'
                   END;
BEGIN
  RETURN jsonb_build_object(
    'censor_source', v_source,
    'min_sample',    MIN_SAMPLE,
    'rows', (
      WITH base AS (
        SELECT
          p.user_id,
          CASE WHEN p.ended_at IS NOT NULL THEN 1 ELSE 0 END AS is_event,
          CASE
            WHEN p.ended_at IS NOT NULL THEN p.ended_at - p.started_at
            ELSE LEAST(CASE v_source
                         WHEN 'desk' THEN p.censor_desk
                         WHEN 'plan' THEN p.censor_plan
                         ELSE p.censor_captured
                       END, CURRENT_DATE) - p.started_at
          END AS days,
          CASE
            WHEN p.price <  5000 THEN '1_under5k'
            WHEN p.price < 10000 THEN '2_5k_10k'
            WHEN p.price < 30000 THEN '3_10k_30k'
            ELSE                      '4_over30k'
          END AS band
        FROM _public_desk_usage_periods() p
        WHERE p.mode = 'active' AND NOT p.is_anomaly AND p.period_index = 1
          AND p.category IS DISTINCT FROM 'Cable'
          AND p.price IS NOT NULL AND p.price > 0
          AND (p.ended_at IS NOT NULL
               OR (CASE v_source
                     WHEN 'desk' THEN p.censor_desk
                     WHEN 'plan' THEN p.censor_plan
                     ELSE p.censor_captured
                   END) IS NOT NULL)
      ),
      valid AS (SELECT * FROM base WHERE days >= 0)
      SELECT COALESCE(jsonb_agg(row ORDER BY row->>'band'), '[]'::JSONB) FROM (
        SELECT jsonb_build_object(
          'band',   band,
          'ready',  COUNT(DISTINCT user_id) >= MIN_SAMPLE,
          'owners', CASE WHEN COUNT(DISTINCT user_id) >= MIN_SAMPLE THEN COUNT(DISTINCT user_id) END,
          'observations', CASE WHEN COUNT(DISTINCT user_id) >= MIN_SAMPLE THEN COUNT(*) END,
          'events',       CASE WHEN COUNT(DISTINCT user_id) >= MIN_SAMPLE THEN SUM(is_event) END,
          -- 打ち切りを含むため中央値は参考値。KM は category 側で出す
          'median_days',  CASE WHEN COUNT(DISTINCT user_id) >= MIN_SAMPLE
                            THEN ROUND(percentile_cont(0.50) WITHIN GROUP (ORDER BY days)) END
        ) AS row
        FROM valid GROUP BY band
      ) t
    )
  );
END;
$fn$;

-- ─── 権限 ─────────────────────────────────────────────────────
-- 028/029 と同じ方針。Supabase は public スキーマの関数に anon/authenticated への
-- EXECUTE を既定で付けるため、REVOKE ALL の後に service_role だけへ GRANT する。
REVOKE ALL ON FUNCTION public.admin_gadget_data_quality()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_gadget_tenure_by_category(TEXT)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_gadget_cooccurrence()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_gadget_connections()              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_gadget_tenure_by_price_band(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_gadget_data_quality()             TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_gadget_tenure_by_category(TEXT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_gadget_cooccurrence()             TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_gadget_connections()              TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_gadget_tenure_by_price_band(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
