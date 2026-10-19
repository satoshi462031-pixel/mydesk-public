-- =============================================================
-- Migration 079: 検索結果を「デスク / ユーザー」に分け、当たった機材と
--                ブランドを結果の上に出す
--
-- 公開デスクは週に何件も増えない。更新の少ない一覧が採っている手は、
-- コンテンツを増やすことではなく同じ在庫への入口を増やすこと
-- （workspaces.xyz の Gear ディレクトリ、PCPartPicker のパーツ→ビルド、
-- RoomClip のタグ）。デスクが4件でも、そこに載っている機材は数十件ある。
--
-- 新しいテーブルは作らない。機材は公開時に焼いた devices、人は desks に
-- 焼いてある owner_* をそのまま束ねる（プロフィールの実体は desks 側にしかない）。
--
-- 検索語の当て方は search_public_desks（070 / 075）と揃える。空白で割った語の
-- AND、ブランドとカテゴリの別名は既存の辞書関数を通す。ここだけ別の当て方に
-- すると、同じ語を打っているのにタブによって当たり外れが変わる。
-- =============================================================

-- ─── 1) ガジェットの棚 ──────────────────────────────────────
-- 束ねる単位は name + category。product_id ではないのは、予測変換から選んだ
-- 機材にしか product_id が入っておらず（073）、手入力の機材が棚から丸ごと
-- 落ちるため。逆引き（listPublicDesksWithGadget）も name + category の一致で
-- 引いているので、ここで叩いた行と遷移先の一覧が食い違わない。
--
-- 数は DISTINCT desk_id。同じデスクに同じ機材が2台あっても「使っているデスク」は
-- 1件で、そこを台数で数えると2台持ちの人が棚の順位を動かせてしまう。
CREATE OR REPLACE FUNCTION public.search_public_gear(
  p_query TEXT DEFAULT '',
  p_limit INTEGER DEFAULT 40
)
RETURNS TABLE (
  name TEXT,
  category TEXT,
  desk_count INTEGER,
  product_id UUID,
  -- 公開時に焼いた英字表記（075）。関連（同じブランドのデスク）を引く軸になる
  brand TEXT
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
    SELECT dev.desk_id, dev.name, dev.category, dev.product_id, dev.brand
    FROM public.devices AS dev
    JOIN public.desks AS d ON d.id = dev.desk_id AND d.visibility = 'public'
    CROSS JOIN params AS p
    -- 自分のデスクは数にも入れない。開いた先の一覧（listPublicDesksWithGadget →
    -- loadVisiblePublicDeskPage）が自分を外すので、ここで数えると
    -- 「3件」と書いてあるのに開くと2件、という食い違いになる
    WHERE d.user_id IS DISTINCT FROM auth.uid()
      AND coalesce(dev.name, '') <> ''
      -- 撤去済みの機材は棚に出さない。持っていないものを「使っている」と数えない
      AND dev.removed_at IS NULL
      AND (
        p.query = ''
        OR NOT EXISTS (
          SELECT 1
          FROM tokens AS token
          WHERE NOT (
            strpos(lower(dev.name), token.term) > 0
            OR strpos(lower(dev.category), token.term) > 0
            OR strpos(lower(coalesce(dev.brand, '')), token.term) > 0
            -- 「ロジクール」で Logitech の機材に当てる。中身は公開時に焼いた別名（075）
            OR public.search_alias_matches(dev.brand_aliases, token.term)
            OR public.search_alias_matches(
              public.device_category_search_aliases(dev.category), token.term)
          )
        )
      )
  )
  SELECT
    m.name,
    m.category,
    count(DISTINCT m.desk_id)::INTEGER AS desk_count,
    -- 商品ページへ繋ぐための代表。1台も予測変換から選ばれていなければ NULL
    (array_agg(m.product_id) FILTER (WHERE m.product_id IS NOT NULL))[1] AS product_id,
    (array_agg(m.brand) FILTER (WHERE m.brand IS NOT NULL))[1] AS brand
  FROM matched AS m
  GROUP BY m.name, m.category
  ORDER BY count(DISTINCT m.desk_id) DESC, m.name ASC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 100));
$$;

REVOKE ALL ON FUNCTION public.search_public_gear(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_gear(TEXT, INTEGER) TO anon, authenticated;

-- ─── 2) 人（公開プロフィール）────────────────────────────────
-- 束ねるのは owner_tag。プロフィール画面（/u/:tag）がタグで引く作りなので、
-- ここも同じ鍵で返す。タグの無いデスク（062 で必須にする前のもの）は
-- 開く先が無いので出さない。
--
-- 表示名とアイコンは最新のデスクのものを採る。デスクごとに焼いた値なので、
-- 名前を変えた人は古いデスクに古い名前が残っている。一覧に出すのは「今の名前」。
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

-- ─── 3) 検索語に当たったブランド ────────────────────────────
-- 結果の上に出す見出し用。押せばお気に入りに入れられて、商品一覧へも行ける。
--
-- brand_key は作らない。キーの作り方（compactBrand）も表示名も端末側の辞書に
-- あり、SQL に写すと二重管理になって必ずずれる（074 / 075 と同じ判断）。
-- ここが返すのは公開時に焼いた英字表記だけで、キーと表示名は端末側で引き直す。
--
-- 当てるのはブランドの語だけ。機材名の一部に当たっただけで見出しを出すと、
-- 「モニター」と打っただけで Dell の見出しが立つ。
CREATE OR REPLACE FUNCTION public.search_public_brands(
  p_query TEXT DEFAULT '',
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  brand TEXT,
  desk_count INTEGER
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
    SELECT dev.desk_id, dev.brand
    FROM public.devices AS dev
    JOIN public.desks AS d ON d.id = dev.desk_id AND d.visibility = 'public'
    CROSS JOIN params AS p
    WHERE d.user_id IS DISTINCT FROM auth.uid()
      AND coalesce(dev.brand, '') <> ''
      AND dev.removed_at IS NULL
      AND p.query <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM tokens AS token
        WHERE NOT (
          strpos(lower(dev.brand), token.term) > 0
          -- 「ロジクール」で Logitech に当てる。中身は公開時に焼いた別名（075）
          OR public.search_alias_matches(dev.brand_aliases, token.term)
        )
      )
  )
  SELECT
    m.brand,
    count(DISTINCT m.desk_id)::INTEGER AS desk_count
  FROM matched AS m
  GROUP BY m.brand
  ORDER BY count(DISTINCT m.desk_id) DESC, m.brand ASC
  LIMIT greatest(1, least(coalesce(p_limit, 5), 10));
$$;

REVOKE ALL ON FUNCTION public.search_public_brands(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_brands(TEXT, INTEGER) TO anon, authenticated;

-- ─── 4) 関連するデスク ──────────────────────────────────────
-- 「その機材を使っているデスク」を出し切ったあと、同じブランド・同じ種類の
-- 機材を使っているデスクを続ける。公開デスクは数が増えないので、語に完全に
-- 当たる1件で画面が終わると、探しに来た人がそこで行き止まりになる。
--
-- 戻り列は search_public_desks と同じ。同じタイルへそのまま流すため。
CREATE OR REPLACE FUNCTION public.list_public_desks_by_gear(
  p_brand TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_exclude UUID[] DEFAULT NULL,
  p_limit INTEGER DEFAULT 12
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  owner_name TEXT,
  owner_tag TEXT,
  owner_avatar_url TEXT,
  purposes TEXT[],
  total_price INTEGER,
  updated_at TIMESTAMPTZ,
  content_updated_at TIMESTAMPTZ,
  attributes TEXT[],
  desk_photos JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.user_id,
    d.title,
    d.owner_name,
    d.owner_tag,
    d.owner_avatar_url,
    d.purposes,
    d.total_price,
    d.updated_at,
    d.content_updated_at,
    d.attributes,
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('id', dp.id, 'image_url', dp.image_url, 'sort_order', dp.sort_order)
        ORDER BY dp.sort_order, dp.id
      )
      FROM public.desk_photos AS dp
      WHERE dp.desk_id = d.id
    ), '[]'::jsonb) AS desk_photos
  FROM public.desks AS d
  WHERE d.visibility = 'public'
    AND d.user_id IS DISTINCT FROM auth.uid()
    -- 軸を1つも渡さない呼び方は、公開デスク全件を返す事故にしかならない
    AND (p_brand IS NOT NULL OR p_category IS NOT NULL)
    AND (p_exclude IS NULL OR NOT (d.id = ANY(p_exclude)))
    AND EXISTS (
      SELECT 1
      FROM public.devices AS dev
      WHERE dev.desk_id = d.id
        AND dev.removed_at IS NULL
        AND (p_brand IS NULL OR lower(coalesce(dev.brand, '')) = lower(p_brand))
        AND (p_category IS NULL OR dev.category = p_category)
    )
  ORDER BY d.updated_at DESC, d.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 12), 30));
$$;

REVOKE ALL ON FUNCTION public.list_public_desks_by_gear(TEXT, TEXT, UUID[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_desks_by_gear(TEXT, TEXT, UUID[], INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
