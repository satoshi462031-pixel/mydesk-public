-- =============================================================
-- Migration 080: 人の検索（079）が公開プロフィールの設定を見ていなかった
--
-- 057 で入れた profile_discoverable は「デスク 1 件ごとの公開はそのままに、
-- 人単位の集約だけ止める」設定で、閲覧側から join できないため
-- desks.owner_profile_public へコピーしてある。プロフィール本体を引く
-- listPublicDesksByTag / listPublicDeskSnapshotsByTag は
-- `.eq('owner_profile_public', true)` で絞っていたが、079 で足した
-- search_public_profiles にこの条件が無かった。
--
-- そのため OFF にしていても、検索の「人」タブに表示名・アイコン・
-- 公開デスクの件数つきで並ぶ。開いた先（/u/<tag>）は絞り込み済みなので
-- 空になり、まさに 057 が止めようとした「何件持っているか」を含む集約だけが
-- 検索結果の行として出ていた。
--
-- 端末側で外す形にはしない。RPC の戻り値に載った時点で漏れている。
--
-- 変えたのは matched の WHERE に 1 行足しただけで、他は 079 のまま。
-- =============================================================

CREATE OR REPLACE FUNCTION public.search_public_profiles(
  p_query TEXT DEFAULT '',
  p_limit INTEGER DEFAULT 30
)
RETURNS TABLE (
  owner_tag TEXT,
  -- ブロック済みの相手を一覧から外すのは端末側（getBlockedUserIds は user_id を持つ）。
  -- tag しか返さないと突き合わせる鍵が無くなる
  user_id UUID,
  owner_name TEXT,
  owner_avatar_url TEXT,
  desk_count INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT lower(left(trim(regexp_replace(coalesce(p_query, ''), '[[:space:]]+', ' ', 'g')), 80)) AS query
  ), tokens AS (
    SELECT value AS term
    FROM params
    CROSS JOIN LATERAL regexp_split_to_table(params.query, ' ') AS value
    WHERE value <> ''
  ), matched AS (
    SELECT d.owner_tag, d.user_id, d.owner_name, d.owner_avatar_url, d.updated_at
    FROM public.desks AS d
    CROSS JOIN params AS p
    WHERE d.visibility = 'public'
      -- 057。人単位でまとめられるのを止めている人は、この一覧にも出さない
      AND d.owner_profile_public
      -- 自分は出さない。自分のプロフィールはマイページから開くもので、
      -- 他人を探している場所に混ざっても押す先が変わるだけになる
      AND d.user_id IS DISTINCT FROM auth.uid()
      AND coalesce(d.owner_tag, '') <> ''
      AND (
        p.query = ''
        OR NOT EXISTS (
          SELECT 1
          FROM tokens AS token
          WHERE NOT (
            strpos(lower(coalesce(d.owner_name, '')), token.term) > 0
            -- タグは # を外した数字でも当てる。画面では #000000 と出しているので
            -- 「000000」と打つ人も「#000000」と打つ人もいる
            OR strpos(lower(coalesce(d.owner_tag, '')), token.term) > 0
            OR strpos(lower(replace(coalesce(d.owner_tag, ''), '#', '')), token.term) > 0
            -- 公式（#000000）は表示名を持たない代わりに、この語で引けるようにする
            OR strpos(lower(CASE
              WHEN replace(coalesce(d.owner_tag, ''), '#', '') = '000000' THEN 'MyDesk Official MyDesk 公式'
              ELSE ''
            END), token.term) > 0
          )
        )
      )
  )
  SELECT
    m.owner_tag,
    (array_agg(m.user_id ORDER BY m.updated_at DESC))[1] AS user_id,
    (array_agg(m.owner_name ORDER BY m.updated_at DESC))[1] AS owner_name,
    (array_agg(m.owner_avatar_url ORDER BY m.updated_at DESC))[1] AS owner_avatar_url,
    count(*)::INTEGER AS desk_count,
    max(m.updated_at) AS updated_at
  FROM matched AS m
  GROUP BY m.owner_tag
  ORDER BY count(*) DESC, max(m.updated_at) DESC
  LIMIT greatest(1, least(coalesce(p_limit, 30), 60));
$$;

REVOKE ALL ON FUNCTION public.search_public_profiles(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_profiles(TEXT, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
