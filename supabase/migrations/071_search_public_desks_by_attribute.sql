-- =============================================================
-- Migration 071: 公開デスクを属性キーで絞れるようにする
--
-- 058 で desks.attributes（'theme:wood' / 'os:macOS' / 'form:laptop' …）を持たせたが、
-- 使い道は公開プロフィールの属性行を「表示する」だけだった。属性は本来
-- 「同じ条件のデスクを探す」ための軸なので、そこから横断できないと置いた意味が無い。
--
-- 070 の p_purpose と同じ形で p_attribute を足す。関数は引数が増えるので
-- DROP してから作り直す（本体は 070 のまま、candidates の WHERE に1行足すだけ）。
--
-- 用途（purpose:*）はこの引数を使わない。attributes は 058 以降に公開し直した
-- デスクにしか入っていないのに対し、purposes 列は全デスクが持っている。
-- 用途チップは今までどおり p_purpose で絞る。
-- =============================================================

-- 属性は配列の包含（@>）で引く。GIN が無いと公開デスク全件の走査になる
CREATE INDEX IF NOT EXISTS desks_attributes_idx
  ON public.desks USING GIN (attributes);

DROP FUNCTION IF EXISTS public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ, TEXT);

CREATE FUNCTION public.search_public_desks(
  p_query TEXT,
  p_limit INTEGER DEFAULT 20,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_purpose TEXT DEFAULT NULL,
  p_attribute TEXT DEFAULT NULL
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
  WITH params AS (
    SELECT lower(left(trim(regexp_replace(coalesce(p_query, ''), '[[:space:]]+', ' ', 'g')), 80)) AS query
  ), tokens AS (
    SELECT value AS term
    FROM params
    CROSS JOIN LATERAL regexp_split_to_table(params.query, ' ') AS value
    WHERE value <> ''
  ), candidates AS (
    SELECT
      d.*,
      lower(coalesce((
        SELECT string_agg(array_to_string(public.purpose_search_aliases(purpose.value), ' '), ' ')
        FROM unnest(d.purposes) AS purpose(value)
      ), '')) AS purpose_text,
      lower(coalesce(d.share_snapshot->'plan'->>'otherPurposeLabel', '')) AS other_purpose
    FROM public.desks AS d
    WHERE d.visibility = 'public'
      AND (p_before IS NULL OR d.updated_at < p_before)
      -- 用途チップ。表記ゆれと無関係に当てたいので、辞書ではなく保存値そのもので絞る
      AND (p_purpose IS NULL OR d.purposes @> ARRAY[p_purpose])
      -- 属性（058 のキー）。'theme:wood' / 'os:macOS' のような言語非依存のキーで
      -- そのまま絞る。用途は purposes 側で絞る（attributes は 058 以降に公開し直した
      -- デスクにしか入っておらず、purpose を attributes で当てると古いデスクが落ちる）
      AND (p_attribute IS NULL OR d.attributes @> ARRAY[p_attribute])
  )
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
  FROM candidates AS d
  CROSS JOIN params AS p
  WHERE p.query = ''
    OR NOT EXISTS (
      SELECT 1
      FROM tokens AS token
      WHERE NOT (
        strpos(lower(d.title), token.term) > 0
        OR strpos(lower(coalesce(d.description, '')), token.term) > 0
        OR strpos(lower(coalesce(d.owner_name, '')), token.term) > 0
        OR strpos(lower(coalesce(d.owner_tag, '')), token.term) > 0
        OR strpos(d.purpose_text, token.term) > 0
        OR strpos(d.other_purpose, token.term) > 0
        -- 「ゲーミング環境」のような複合語から、辞書の語を拾う
        OR EXISTS (
          SELECT 1
          FROM unnest(d.purposes) AS purpose(value)
          WHERE public.search_alias_matches(public.purpose_search_aliases(purpose.value), token.term)
        )
        OR strpos(lower(CASE d.id
          WHEN '1053c603-25cc-46cb-aa06-284ac9d2fbaf'::UUID THEN
            'Gaming PC Switch 2 Entry-level Gaming PC 24-inch 165Hz Monitor Wireless Gaming Mouse Compact Mechanical Keyboard Wired Gaming Headset 6-Outlet Power Strip'
          WHEN '458fa607-269b-421d-a619-01375992fb97'::UUID THEN
            'Creator One Cable 14-inch Creator Laptop 27-inch USB-C Monitor Low-profile Bluetooth Keyboard Silent Bluetooth Mouse Portable SSD 1TB 6-Outlet Power Strip'
          WHEN 'c40c79b0-5aaa-47fb-a271-a5e45026c230'::UUID THEN
            'Music DTM Starter Setup Compact Production PC 24-inch IPS Monitor 2-Input Audio Interface Entry-level Condenser Microphone 25-key MIDI Keyboard Closed-back Monitor Headphones 6-Outlet Power Strip'
          WHEN 'ebab39f1-c298-411a-9b79-40c89837e313'::UUID THEN
            'Mobile Work Cafe Travel 13-inch Lightweight Laptop 65W USB-C Charger 10000mAh Power Bank Low-profile Bluetooth Mouse Mid-range Smartphone'
          ELSE ''
        END), token.term) > 0
        OR strpos(lower(CASE
          WHEN replace(coalesce(d.owner_tag, ''), '#', '') = '000000' THEN 'MyDesk Official MyDesk 公式 #000000'
          ELSE ''
        END), token.term) > 0
        OR EXISTS (
          SELECT 1
          FROM public.devices AS device
          WHERE device.desk_id = d.id
            AND (
              strpos(lower(device.name), token.term) > 0
              OR strpos(lower(device.category), token.term) > 0
              OR strpos(lower(coalesce(device.brand, '')), token.term) > 0
              OR public.search_alias_matches(
                public.device_category_search_aliases(device.category), token.term)
            )
        )
      )
    )
  ORDER BY
    CASE
      WHEN d.other_purpose = p.query THEN 5
      WHEN EXISTS (
        SELECT 1 FROM unnest(d.purposes) AS purpose(value)
        CROSS JOIN LATERAL unnest(public.purpose_search_aliases(purpose.value)) AS alias(value)
        WHERE lower(alias.value) = p.query
      ) THEN 4
      WHEN d.other_purpose LIKE p.query || '%' THEN 3
      WHEN EXISTS (
        SELECT 1 FROM unnest(d.purposes) AS purpose(value)
        CROSS JOIN LATERAL unnest(public.purpose_search_aliases(purpose.value)) AS alias(value)
        WHERE lower(alias.value) LIKE p.query || '%' OR p.query LIKE lower(alias.value) || '%'
      ) THEN 3
      WHEN NOT EXISTS (
        SELECT 1 FROM tokens AS token
        WHERE strpos(d.purpose_text || ' ' || d.other_purpose, token.term) = 0
      ) THEN 2
      WHEN EXISTS (
        SELECT 1 FROM tokens AS token
        WHERE strpos(d.purpose_text || ' ' || d.other_purpose, token.term) > 0
      ) THEN 1
      ELSE 0
    END DESC,
    d.updated_at DESC,
    d.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$$;

REVOKE ALL ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_desks(TEXT, INTEGER, TIMESTAMPTZ, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
