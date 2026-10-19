-- =============================================================
-- 043 の在籍継続率（カプラン・マイヤー）の境界値テスト。
--
-- ★ 本番では実行しない。ローカル（supabase start → supabase db reset）か
--   ブランチDBで実行すること。auth.users と desks へ検証用の行を作る。
--   全体が BEGIN 〜 ROLLBACK に入っているので、最後まで流せば何も残らない。
--
--   psql "$LOCAL_DB_URL" -f supabase/tests/043_tenure_boundaries.test.sql
--
-- MIN_SAMPLE = 30 はユニーク所有者数で判定するため、各ケースで 30 人ぶんの
-- デスクを作る。所有者が 29 人だと ready:false になることも検証する。
--
-- 打ち切り日は share_snapshot.snapshotCapturedAt（version 3 以降）を使う。
-- 旧データ（version 2、保存日時なし）が公開対象から外れることも検証する。
-- =============================================================

BEGIN;

-- ─── 検証用の公開デスクを作るヘルパ ───────────────────────────
-- periods は deskUsagePeriods の配列をそのまま渡す。
CREATE OR REPLACE FUNCTION pg_temp.make_desk(
  p_index INTEGER,
  p_category TEXT,
  p_periods JSONB,
  p_plan_updated_at TEXT DEFAULT '2030-01-01T00:00:00.000Z',
  -- NULL を渡すと version 2 相当（snapshotCapturedAt を持たない旧データ）になる
  p_captured_at TEXT DEFAULT '2030-01-01T00:00:00.000Z'
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_user UUID := gen_random_uuid();
  v_desk UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000'::UUID, v_user, 'authenticated', 'authenticated',
          'km-test-' || p_index || '-' || v_user || '@example.test', '', now(), now());

  INSERT INTO desks (id, user_id, title, visibility, share_snapshot, created_at, updated_at)
  VALUES (v_desk, v_user, 'km-test', 'public',
    jsonb_build_object(
      'version', CASE WHEN p_captured_at IS NULL THEN 2 ELSE 3 END,
      'snapshotCapturedAt', p_captured_at,
      'plan', jsonb_build_object('id', v_desk::TEXT, 'updatedAt', p_plan_updated_at),
      'gadgets', jsonb_build_array(jsonb_build_object(
        'id', 'g' || p_index,
        'category', p_category,
        'price', 12000,
        'deskUsagePeriods', p_periods
      ))
    ),
    now(), now());
  RETURN v_desk;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.row_for(p_category TEXT) RETURNS JSONB
LANGUAGE sql AS $$
  SELECT r FROM jsonb_array_elements(
    (admin_gadget_tenure_by_category('captured')->'rows')) AS x(r)
  WHERE r->>'category' = p_category;
$$;

CREATE OR REPLACE FUNCTION pg_temp.check(p_label TEXT, p_ok BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok THEN
    RAISE NOTICE 'ok   %', p_label;
  ELSE
    RAISE EXCEPTION 'FAIL %', p_label;
  END IF;
END;
$$;

-- 既存データが混ざらないよう、テスト対象カテゴリは実在しない名前にする
-- （Cable 除外の検証だけ 'Cable' を使う）。

-- ═══ 1. 全件イベント：30人全員が 100 日で撤去 ═══════════════
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 1..30 LOOP
    PERFORM pg_temp.make_desk(i, 'TestAllEvents', jsonb_build_array(
      jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-04-11')));
  END LOOP;
END;
$$;

DO $$
DECLARE r JSONB := pg_temp.row_for('TestAllEvents');
BEGIN
  PERFORM pg_temp.check('全件イベント: ready',            (r->>'ready')::BOOLEAN);
  PERFORM pg_temp.check('全件イベント: owners=30',        (r->>'owners')::INT = 30);
  PERFORM pg_temp.check('全件イベント: events=30',        (r->>'events')::INT = 30);
  PERFORM pg_temp.check('全件イベント: censored=0',       (r->>'censored')::INT = 0);
  -- 100日で全員脱落 → 90日時点は 100%、180日時点は 0%
  PERFORM pg_temp.check('全件イベント: S(90)=100',        (r->>'s90')::NUMERIC = 100);
  PERFORM pg_temp.check('全件イベント: S(180)=0',         (r->>'s180')::NUMERIC = 0);
  PERFORM pg_temp.check('全件イベント: 中央値=100日',     (r->>'median_days')::INT = 100);
  PERFORM pg_temp.check('全件イベント: 中央値到達',       (r->>'median_reached')::BOOLEAN);
END;
$$;

-- ═══ 2. 全件打ち切り：誰も撤去していない ═════════════════════
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 101..130 LOOP
    PERFORM pg_temp.make_desk(i, 'TestAllCensored', jsonb_build_array(
      jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01')));
  END LOOP;
END;
$$;

DO $$
DECLARE r JSONB := pg_temp.row_for('TestAllCensored');
BEGIN
  PERFORM pg_temp.check('全件打ち切り: events=0',        (r->>'events')::INT = 0);
  PERFORM pg_temp.check('全件打ち切り: censored=30',     (r->>'censored')::INT = 30);
  -- イベントが1件も無ければ S(t) は 100% のまま
  PERFORM pg_temp.check('全件打ち切り: S(90)=100',       (r->>'s90')::NUMERIC = 100);
  PERFORM pg_temp.check('全件打ち切り: S(730)=100',      (r->>'s730')::NUMERIC = 100);
  PERFORM pg_temp.check('全件打ち切り: 中央値未到達',    NOT (r->>'median_reached')::BOOLEAN);
  PERFORM pg_temp.check('全件打ち切り: median_days=null', r->>'median_days' IS NULL);
END;
$$;

-- ═══ 3. 中央値未到達：3割だけ撤去 ════════════════════════════
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 201..230 LOOP
    IF i <= 209 THEN
      PERFORM pg_temp.make_desk(i, 'TestNoMedian', jsonb_build_array(
        jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-03-02')));
    ELSE
      PERFORM pg_temp.make_desk(i, 'TestNoMedian', jsonb_build_array(
        jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01')));
    END IF;
  END LOOP;
END;
$$;

DO $$
DECLARE r JSONB := pg_temp.row_for('TestNoMedian');
BEGIN
  PERFORM pg_temp.check('中央値未到達: events=9',        (r->>'events')::INT = 9);
  PERFORM pg_temp.check('中央値未到達: S(90)=70',        (r->>'s90')::NUMERIC = 70.0);
  PERFORM pg_temp.check('中央値未到達: median_reached=false', NOT (r->>'median_reached')::BOOLEAN);
END;
$$;

-- ═══ 4. MIN_SAMPLE の境界：29人は ready:false、30人で true ═══
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 301..329 LOOP  -- 29 人
    PERFORM pg_temp.make_desk(i, 'TestBoundary29', jsonb_build_array(
      jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-02-01')));
  END LOOP;
END;
$$;

DO $$
DECLARE r JSONB := pg_temp.row_for('TestBoundary29');
BEGIN
  PERFORM pg_temp.check('境界29: ready=false',           NOT (r->>'ready')::BOOLEAN);
  -- 未満のときは件数も内訳も返さない（少人数の特定を避ける）
  PERFORM pg_temp.check('境界29: owners を返さない',      r->>'owners' IS NULL);
  PERFORM pg_temp.check('境界29: S(90) を返さない',       r->>'s90' IS NULL);
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.make_desk(330, 'TestBoundary29', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-02-01')));
END;
$$;

DO $$
DECLARE r JSONB := pg_temp.row_for('TestBoundary29');
BEGIN
  PERFORM pg_temp.check('境界30: ready=true',            (r->>'ready')::BOOLEAN);
  PERFORM pg_temp.check('境界30: owners=30',             (r->>'owners')::INT = 30);
END;
$$;

-- ═══ 5. 同一所有者が複数デスクを持っても所有者数は増えない ═══
DO $$
DECLARE v_user UUID; i INTEGER; v_desk UUID;
BEGIN
  v_user := gen_random_uuid();
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000'::UUID, v_user, 'authenticated', 'authenticated',
          'km-multi-' || v_user || '@example.test', '', now(), now());
  FOR i IN 1..5 LOOP
    v_desk := gen_random_uuid();
    INSERT INTO desks (id, user_id, title, visibility, share_snapshot, created_at, updated_at)
    VALUES (v_desk, v_user, 'km-multi', 'public',
      jsonb_build_object('version', 2,
        'plan', jsonb_build_object('updatedAt', '2030-01-01T00:00:00.000Z'),
        'gadgets', jsonb_build_array(jsonb_build_object(
          'id', 'gm' || i, 'category', 'TestMultiDesk', 'price', 1000,
          'deskUsagePeriods', jsonb_build_array(
            jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-02-01'))))),
      now(), now());
  END LOOP;
END;
$$;

DO $$
DECLARE q JSONB := admin_gadget_data_quality();
BEGIN
  -- 5デスク作っても所有者は1人。観測数と所有者数を混同していないことの確認
  PERFORM pg_temp.check('複数デスク: 期間は5件',
    (SELECT COUNT(*) FROM _public_desk_usage_periods() WHERE category = 'TestMultiDesk') = 5);
  PERFORM pg_temp.check('複数デスク: 所有者は1人',
    (SELECT COUNT(DISTINCT user_id) FROM _public_desk_usage_periods() WHERE category = 'TestMultiDesk') = 1);
END;
$$;

-- ═══ 6. 異常値・除外の扱い ═══════════════════════════════════
DO $$
BEGIN
  -- 終了日が開始日より前
  PERFORM pg_temp.make_desk(401, 'TestAnomaly', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '2026-05-01', 'endedAt', '2026-01-01')));
  -- 未来の開始日
  PERFORM pg_temp.make_desk(402, 'TestAnomaly', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '2099-01-01')));
  -- 20年超
  PERFORM pg_temp.make_desk(403, 'TestAnomaly', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '1990-01-01', 'endedAt', '2026-01-01')));
  -- 開始日と終了日が同日（異常ではない。0日の観測として残る）
  PERFORM pg_temp.make_desk(404, 'TestSameDay', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-01-01')));
END;
$$;

DO $$
BEGIN
  PERFORM pg_temp.check('異常値: 3件とも anomaly',
    (SELECT COUNT(*) FROM _public_desk_usage_periods()
     WHERE category = 'TestAnomaly' AND is_anomaly) = 3);
  PERFORM pg_temp.check('同日撤去は異常扱いにしない',
    (SELECT COUNT(*) FROM _public_desk_usage_periods()
     WHERE category = 'TestSameDay' AND NOT is_anomaly) = 1);
END;
$$;

-- ═══ 7. decor / 再導入 / Cable の除外 ════════════════════════
DO $$
BEGIN
  PERFORM pg_temp.make_desk(501, 'TestDecor', jsonb_build_array(
    jsonb_build_object('mode', 'decor', 'startedAt', '2026-01-01', 'endedAt', '2026-02-01')));
  -- 再導入（2期間目）は KM の観測に入れない
  PERFORM pg_temp.make_desk(502, 'TestReintro', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-02-01'),
    jsonb_build_object('mode', 'active', 'startedAt', '2026-03-01', 'endedAt', '2026-04-01')));
  PERFORM pg_temp.make_desk(503, 'Cable', jsonb_build_array(
    jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-02-01')));
END;
$$;

DO $$
DECLARE t JSONB := admin_gadget_tenure_by_category('plan');
BEGIN
  PERFORM pg_temp.check('decor は在籍期間の行に出さない',
    pg_temp.row_for('TestDecor') IS NULL);
  PERFORM pg_temp.check('Cable は集計しない',
    pg_temp.row_for('Cable') IS NULL);
  PERFORM pg_temp.check('再導入は period_index>1 として数える',
    (t->'excluded'->>'reintroduced')::INT >= 1);
  PERFORM pg_temp.check('decor の除外件数を返す',
    (t->'excluded'->>'decor_periods')::INT >= 1);
END;
$$;

-- ═══ 8. snapshotCapturedAt が無い観測は公開対象にしない ═════
DO $$
DECLARE i INTEGER;
BEGIN
  -- version 2 相当（保存日時なし）で継続中の観測を作る
  FOR i IN 601..630 LOOP
    PERFORM pg_temp.make_desk(i, 'TestNoCaptured', jsonb_build_array(
      jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01')), '2030-01-01T00:00:00.000Z', NULL);
  END LOOP;
  -- version 3（保存日時あり）で継続中の観測
  FOR i IN 701..730 LOOP
    PERFORM pg_temp.make_desk(i, 'TestCaptured', jsonb_build_array(
      jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01')));
  END LOOP;
END;
$$;

DO $$
DECLARE t JSONB := admin_gadget_tenure_by_category('captured');
        no_cap JSONB := pg_temp.row_for('TestNoCaptured');
        cap    JSONB := pg_temp.row_for('TestCaptured');
BEGIN
  -- 保存日時が無い継続中の観測は打ち切り日を決められないので行に出ない
  PERFORM pg_temp.check('保存日時なし: 行に出さない', no_cap IS NULL);
  PERFORM pg_temp.check('保存日時なし: 除外件数に出る',
    (t->'excluded'->>'censor_unknown')::INT >= 30);

  PERFORM pg_temp.check('保存日時あり: ready',        (cap->>'ready')::BOOLEAN);
  PERFORM pg_temp.check('保存日時あり: censor_exact', (cap->>'censor_exact')::BOOLEAN);
  PERFORM pg_temp.check('保存日時あり: exact_ratio=1', (cap->>'exact_ratio')::NUMERIC = 1);

  -- plan 起点にすると、保存日時なしの行も plan.updatedAt で救われる（＝代用が効く）
  PERFORM pg_temp.check('plan 起点なら保存日時なしでも観測できる',
    (SELECT COUNT(*) FROM jsonb_array_elements(admin_gadget_tenure_by_category('plan')->'rows') AS x(r)
     WHERE r->>'category' = 'TestNoCaptured') = 1);
END;
$$;

-- ═══ 8-b. イベントだけの行は保存日時が無くても exact ════════
-- 撤去済みの観測は打ち切り日に依存しないため、旧データでも公開対象にできる
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 801..830 LOOP
    PERFORM pg_temp.make_desk(i, 'TestEventsOnlyOld', jsonb_build_array(
      jsonb_build_object('mode', 'active', 'startedAt', '2026-01-01', 'endedAt', '2026-03-01')),
      '2030-01-01T00:00:00.000Z', NULL);
  END LOOP;
END;
$$;

DO $$
DECLARE r JSONB := pg_temp.row_for('TestEventsOnlyOld');
BEGIN
  PERFORM pg_temp.check('全件イベントなら旧データでも exact', (r->>'censor_exact')::BOOLEAN);
  PERFORM pg_temp.check('全件イベントなら censored=0',        (r->>'censored')::INT = 0);
END;
$$;

-- ═══ 9. 共在と直接接続を混同していない ═══════════════════════
-- devices を持たないデスクだけを作ったので、共在は 0 のはず
-- （share_snapshot にガジェットがあっても devices には入らない）
DO $$
DECLARE c JSONB := admin_gadget_cooccurrence();
BEGIN
  PERFORM pg_temp.check('共在は devices を見る（snapshot では増えない）',
    c->>'ready' = 'false' OR jsonb_array_length(COALESCE(c->'rows', '[]'::JSONB)) = 0);
END;
$$;

ROLLBACK;
