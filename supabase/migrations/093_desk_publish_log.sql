-- =============================================================
-- Migration 093: デスクを公開した履歴と、更新頻度の集計（運営用）
--
-- 「デスクをどのくらいの間隔で更新するか」は、既存の列からは出せない。
--   ・share_snapshot.snapshotCapturedAt は公開のたびに上書きされ、最新の1件しか残らない
--   ・desk_versions は総額と台数が変わらないと追加されず、保存件数の上限が tier で違う
--     （Pro のほうが長く残る＝系統バイアス）。クライアントからの fire-and-forget でもある
--   ・desk_push_log はフォロワーへ通知を送ったときにしか書かれない
-- そこで公開のたびに1行だけ残す。記録はトリガで行い、クライアントの書き込みに頼らない
-- （アプリの古いビルドや通信断で抜けると、間隔が実際より長く出る）。
--
-- 残すのは日時と機材の増減数だけ。機材名・写真・本文は持たない（中身は share_snapshot にある）。
-- デスクを消せば ON DELETE CASCADE で一緒に消え、アカウント削除も desks 経由で連鎖する。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.desk_publish_log (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  desk_id         UUID        NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  visibility      TEXT        NOT NULL,
  -- 以下3つは「直前の公開」と比べた値。直前の公開が無い（初回・061 以前の公開）ときは NULL。
  -- 0 と NULL を混ぜると、初回公開が「何も変えずに再公開した」に数えられる
  content_changed BOOLEAN,
  gadgets_added   INTEGER,
  gadgets_removed INTEGER,
  gadget_count    INTEGER     NOT NULL
);

COMMENT ON TABLE public.desk_publish_log IS
  'デスクを公開・更新した履歴（1公開1行）。更新頻度の集計にだけ使う。書くのは log_desk_publish トリガだけ';

CREATE INDEX IF NOT EXISTS desk_publish_log_desk_idx ON public.desk_publish_log (desk_id, published_at);
CREATE INDEX IF NOT EXISTS desk_publish_log_published_idx ON public.desk_publish_log (published_at);

-- ポリシーは作らない。書くのはトリガ（定義者権限）、読むのは service_role の集計だけ
ALTER TABLE public.desk_publish_log ENABLE ROW LEVEL SECURITY;

-- ─── 記録 ──────────────────────────────────────────────────
-- 「公開した」の判定は snapshotCapturedAt の変化で行う。publishService は公開のたびに
-- 新しい時刻を入れるので、いいね数や表示名など他の列の更新では記録されない。
-- share_snapshot 全体の変化で見ると、将来サーバー側でスナップショットを書き換えた
-- マイグレーションが、全デスクの「公開」として記録されてしまう。
--
-- 初回公開では、createDesk（private）と最後の updateDesk が同じスナップショットを書くので
-- 時刻が変わらない。private → public / unlisted の切り替えも公開として拾う。
CREATE OR REPLACE FUNCTION public.log_desk_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_ids JSONB := NEW.share_snapshot->'plan'->'selectedGadgetIds';
  v_old_ids JSONB := OLD.share_snapshot->'plan'->'selectedGadgetIds';
  -- OLD が「完了した公開」のスナップショットかどうか。content_signature は公開の最後の
  -- updateDesk でしか入らないので、初回公開の途中で作られた行（createDesk）と区別できる。
  -- 時刻が同じなら中身は再送されておらず、公開範囲だけを切り替えた更新
  v_prev_published BOOLEAN :=
    OLD.content_signature IS NOT NULL
    AND (OLD.share_snapshot->>'snapshotCapturedAt') IS DISTINCT FROM (NEW.share_snapshot->>'snapshotCapturedAt');
  v_added   INTEGER;
  v_removed INTEGER;
BEGIN
  IF jsonb_typeof(v_new_ids) IS DISTINCT FROM 'array' THEN v_new_ids := '[]'::JSONB; END IF;
  IF jsonb_typeof(v_old_ids) IS DISTINCT FROM 'array' THEN v_old_ids := '[]'::JSONB; END IF;

  IF v_prev_published THEN
    SELECT count(DISTINCT n.id) INTO v_added
    FROM jsonb_array_elements_text(v_new_ids) AS n(id)
    WHERE NOT (v_old_ids ? n.id);

    SELECT count(DISTINCT o.id) INTO v_removed
    FROM jsonb_array_elements_text(v_old_ids) AS o(id)
    WHERE NOT (v_new_ids ? o.id);
  END IF;

  INSERT INTO public.desk_publish_log
    (desk_id, user_id, visibility, content_changed, gadgets_added, gadgets_removed, gadget_count)
  VALUES (
    NEW.id,
    NEW.user_id,
    NEW.visibility,
    CASE WHEN v_prev_published
         THEN NEW.content_signature IS DISTINCT FROM OLD.content_signature END,
    v_added,
    v_removed,
    (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(v_new_ids) AS x)
  );
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.log_desk_publish() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS desks_publish_log ON public.desks;
CREATE TRIGGER desks_publish_log
  AFTER UPDATE ON public.desks
  FOR EACH ROW
  WHEN (
    NEW.visibility IN ('public', 'unlisted')
    AND (
      OLD.visibility IS DISTINCT FROM NEW.visibility
      OR (OLD.share_snapshot->>'snapshotCapturedAt') IS DISTINCT FROM (NEW.share_snapshot->>'snapshotCapturedAt')
    )
  )
  EXECUTE FUNCTION public.log_desk_publish();

-- 既存の公開デスクは backfill しない。snapshotCapturedAt は最後の公開時刻として正しいが、
-- 「その前の公開」が分からないので間隔の起点にしかならず、次の公開の差分も
-- v_prev_published の判定で取れる（OLD が既存の公開スナップショットになる）。

-- ─── 集計：更新の頻度 ──────────────────────────────────────
-- 2つの別の問いに答える。混ぜない。
--
-- publish … アプリでデスクを公開し直す間隔（この 093 から記録が始まる）
--   間隔は同じデスクの連続する公開の差。中身が変わった公開だけの間隔も別に出す
--   （写真を1枚差し替えただけの再公開と、何もしない再公開が同じ重さになるのを避ける）。
--
-- gear … 実生活で機材が入れ替わる間隔（share_snapshot の導入日・撤去日から）
--   利用者が過去の購入日までさかのぼって入れるので、公開の記録が少ないうちから出せる。
--   同じ日の追加・撤去は1回の「変化」に数える（初期登録で同じ日付が並ぶため）。
--   自動で入る撤去日は「アプリで外した日」で、実際に外した日とは限らない。
--
-- どちらも母集団は公開デスクだけで、公開する熱心な人ほど多く入る（頻度は高めに出る）。
-- 公式・デモのアカウントは除く。判定は 043 と同じくユニーク所有者数 30 で ready。
CREATE OR REPLACE FUNCTION public.admin_desk_update_cadence()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  MIN_SAMPLE CONSTANT INTEGER := 30;
  v_publish JSONB;
  v_gear    JSONB;
BEGIN
  -- ── publish ──
  WITH excluded_owners AS (
    -- 088 のデモデスクと、090 の公式アカウント
    SELECT user_id FROM desks
    WHERE id = ANY(ARRAY[
      '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
      '458fa607-269b-421d-a619-01375992fb97',
      'c40c79b0-5aaa-47fb-a271-a5e45026c230',
      'ebab39f1-c298-411a-9b79-40c89837e313'
    ]::UUID[])
    UNION
    SELECT id FROM profiles WHERE is_official
  ),
  logs AS (
    SELECT l.* FROM desk_publish_log l
    WHERE NOT EXISTS (SELECT 1 FROM excluded_owners e WHERE e.user_id = l.user_id)
  ),
  all_gaps AS (
    SELECT desk_id, user_id,
           EXTRACT(EPOCH FROM published_at - lag(published_at) OVER w) / 86400.0 AS days
    FROM logs
    WINDOW w AS (PARTITION BY desk_id ORDER BY published_at)
  ),
  -- 中身の変化の間隔は、初回公開を起点にして content_changed の行どうしを結ぶ
  content_points AS (
    SELECT desk_id, user_id, published_at FROM logs
    WHERE content_changed IS TRUE
       OR published_at = (SELECT min(published_at) FROM logs f WHERE f.desk_id = logs.desk_id)
  ),
  content_gaps AS (
    SELECT desk_id, user_id,
           EXTRACT(EPOCH FROM published_at - lag(published_at) OVER w) / 86400.0 AS days
    FROM content_points
    WINDOW w AS (PARTITION BY desk_id ORDER BY published_at)
  )
  SELECT jsonb_build_object(
    'log_rows',         (SELECT count(*) FROM logs),
    'desks',            (SELECT count(DISTINCT desk_id) FROM logs),
    'owners',           (SELECT count(DISTINCT user_id) FROM logs),
    'first_logged_at',  (SELECT min(published_at) FROM logs),
    'ready',            (SELECT count(DISTINCT user_id) FROM all_gaps WHERE days IS NOT NULL) >= MIN_SAMPLE,
    'any_publish', (
      SELECT jsonb_build_object(
        'intervals',   count(*),
        'owners',      count(DISTINCT user_id),
        'median_days', round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY days))::NUMERIC, 1),
        'p25_days',    round((percentile_cont(0.25) WITHIN GROUP (ORDER BY days))::NUMERIC, 1),
        'p75_days',    round((percentile_cont(0.75) WITHIN GROUP (ORDER BY days))::NUMERIC, 1)
      )
      FROM all_gaps WHERE days IS NOT NULL
    ),
    'content_change', (
      SELECT jsonb_build_object(
        'intervals',     count(*),
        'owners',        count(DISTINCT user_id),
        'median_days',   round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY days))::NUMERIC, 1),
        'p25_days',      round((percentile_cont(0.25) WITHIN GROUP (ORDER BY days))::NUMERIC, 1),
        'p75_days',      round((percentile_cont(0.75) WITHIN GROUP (ORDER BY days))::NUMERIC, 1),
        'within_7d',     count(*) FILTER (WHERE days <= 7),
        'within_30d',    count(*) FILTER (WHERE days > 7  AND days <= 30),
        'within_90d',    count(*) FILTER (WHERE days > 30 AND days <= 90),
        'over_90d',      count(*) FILTER (WHERE days > 90)
      )
      FROM content_gaps WHERE days IS NOT NULL
    ),
    -- 公開し直したときの中身。何も変えない再公開の割合もここで分かる
    'republish', (
      SELECT jsonb_build_object(
        'count',              count(*),
        'content_changed',    count(*) FILTER (WHERE content_changed),
        'unchanged',          count(*) FILTER (WHERE NOT content_changed),
        'avg_gadgets_added',  round(avg(gadgets_added)::NUMERIC, 2),
        'avg_gadgets_removed', round(avg(gadgets_removed)::NUMERIC, 2)
      )
      FROM logs WHERE content_changed IS NOT NULL
    )
  ) INTO v_publish;

  -- ── gear ──
  WITH excluded_owners AS (
    SELECT user_id FROM desks
    WHERE id = ANY(ARRAY[
      '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
      '458fa607-269b-421d-a619-01375992fb97',
      'c40c79b0-5aaa-47fb-a271-a5e45026c230',
      'ebab39f1-c298-411a-9b79-40c89837e313'
    ]::UUID[])
    UNION
    SELECT id FROM profiles WHERE is_official
  ),
  periods AS (
    SELECT p.* FROM public._public_desk_usage_periods() p
    WHERE NOT p.is_anomaly
      AND p.mode = 'active'
      AND NOT EXISTS (SELECT 1 FROM excluded_owners e WHERE e.user_id = p.user_id)
  ),
  -- 観測の終わり。043 と同じ優先順（version 3 の保存時刻 → 旧データの代用）
  observed AS (
    SELECT desk_id, max(COALESCE(censor_captured, censor_plan, censor_desk)) AS until_day
    FROM periods GROUP BY desk_id
  ),
  change_days AS (
    SELECT DISTINCT user_id, desk_id, started_at AS day FROM periods
    UNION
    SELECT DISTINCT user_id, desk_id, ended_at FROM periods WHERE ended_at IS NOT NULL
  ),
  gaps AS (
    SELECT user_id, desk_id, day - lag(day) OVER (PARTITION BY desk_id ORDER BY day) AS days
    FROM change_days
  ),
  -- 「1年に何回変わるか」は観測の終わりから遡った365日で数える。
  -- 今日から遡ると、しばらく公開し直していないデスクほど少なく出る
  last_year AS (
    SELECT c.desk_id, count(*) FILTER (
             WHERE c.day > o.until_day - 365 AND c.day <= o.until_day
           ) AS changes
    FROM change_days c JOIN observed o USING (desk_id)
    -- 観測が1年に満たないデスク（初めての機材が1年以内）は、年あたりの回数を少なく見積もるので外す
    WHERE o.until_day - 365 >= (SELECT min(day) FROM change_days m WHERE m.desk_id = c.desk_id)
    GROUP BY c.desk_id
  )
  SELECT jsonb_build_object(
    'desks',  (SELECT count(DISTINCT desk_id) FROM periods),
    'owners', (SELECT count(DISTINCT user_id) FROM periods),
    'ready',  (SELECT count(DISTINCT user_id) FROM gaps WHERE days IS NOT NULL) >= MIN_SAMPLE,
    'change_interval', (
      SELECT jsonb_build_object(
        'intervals',   count(*),
        'owners',      count(DISTINCT user_id),
        'median_days', percentile_cont(0.5)  WITHIN GROUP (ORDER BY days),
        'p25_days',    percentile_cont(0.25) WITHIN GROUP (ORDER BY days),
        'p75_days',    percentile_cont(0.75) WITHIN GROUP (ORDER BY days),
        'within_30d',  count(*) FILTER (WHERE days <= 30),
        'within_90d',  count(*) FILTER (WHERE days > 30  AND days <= 90),
        'within_365d', count(*) FILTER (WHERE days > 90  AND days <= 365),
        'over_365d',   count(*) FILTER (WHERE days > 365)
      )
      FROM gaps WHERE days IS NOT NULL
    ),
    'changes_per_year', (
      SELECT jsonb_build_object(
        'desks',  count(*),
        'median', percentile_cont(0.5)  WITHIN GROUP (ORDER BY changes),
        'p25',    percentile_cont(0.25) WITHIN GROUP (ORDER BY changes),
        'p75',    percentile_cont(0.75) WITHIN GROUP (ORDER BY changes)
      )
      FROM last_year
    )
  ) INTO v_gear;

  RETURN jsonb_build_object(
    'min_sample', MIN_SAMPLE,
    'publish',    v_publish,
    'gear',       v_gear
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_desk_update_cadence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_desk_update_cadence() TO service_role;

NOTIFY pgrst, 'reload schema';
