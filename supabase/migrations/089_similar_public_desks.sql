-- このデスクに近い公開デスク（089）。
--
-- 公開デスク画面の機材タブの末尾に並べる。人のデスクを見終えた人を、次に見る
-- デスクへ送るための段。閲覧者の機材は使わない（ログインしていない人・自分の
-- デスクをまだ作っていない人にも同じように効かせるため）。
--
-- ■ 元のデスクの機材は呼び出し側から配列で受け取る。デスク ID を受けて中身を
--   サーバーで読むと、URL限定（083）のデスクは RLS で devices が読めず、近さが
--   測れない。SECURITY DEFINER で読めば済むが、今度は非公開のデスクの ID を
--   渡すだけで中身との重なりが漏れる。画面はすでに機材を手元に持っている。
-- ■ 照合は listPublicDesksWithGadget と同じ name + category の完全一致
--   （索引は 067 の devices_name_category_idx）。ケーブルは外す。USB-C や HDMI の
--   ケーブルはほぼ全員が持っていて、重なりが近さを何も言わない。
-- ■ 載せるのは 'public' だけ（083 の「載せる側」）。写真の無いデスクは外す
--   （GadgetPublicDesks と同じく、選ぶ手がかりが写真しか無い段なので）。
-- ■ 元のデスクの持ち主の他のデスクは外す。同じ人のデスクは機材がほぼ重なって
--   上位を埋めるうえ、その人のデスクは公開プロフィールから辿れる。
-- ■ 順位は「同じ機材の数 × 2 + 同じ用途の数」。公開デスクが少ないうちは機材の
--   重なりが1件も無いことが多いので、用途だけが同じデスクも下位に残して段を空にしない。
CREATE OR REPLACE FUNCTION public.list_similar_public_desks(
  p_names TEXT[],
  p_categories TEXT[],
  p_purposes TEXT[] DEFAULT NULL,
  p_exclude_desk UUID DEFAULT NULL,
  p_exclude_user UUID DEFAULT NULL,
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
  desk_photos JSONB,
  shared_gadgets INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH src AS (
    -- 配列はアプリが渡すが、上限は SQL 側でも切る（巨大な配列で照合を重くさせない）
    SELECT DISTINCT s.n, s.c
    FROM unnest(p_names, p_categories) AS s(n, c)
    WHERE s.n IS NOT NULL AND s.c IS NOT NULL AND s.c <> 'Cable' AND btrim(s.n) <> ''
    LIMIT 120
  ),
  gear AS (
    SELECT dev.desk_id, count(DISTINCT (dev.name, dev.category))::INTEGER AS shared
    FROM public.devices AS dev
    JOIN src ON dev.name = src.n AND dev.category = src.c
    WHERE dev.removed_at IS NULL
    GROUP BY dev.desk_id
  ),
  scored AS (
    SELECT
      d.*,
      coalesce(g.shared, 0) AS shared_gadgets,
      (
        SELECT count(*)::INTEGER
        FROM unnest(coalesce(d.purposes, '{}'::TEXT[])) AS p(v)
        WHERE p_purposes IS NOT NULL AND p.v = ANY(p_purposes) AND p.v <> 'other'
      ) AS shared_purposes
    FROM public.desks AS d
    LEFT JOIN gear AS g ON g.desk_id = d.id
    WHERE d.visibility = 'public'
      AND d.id IS DISTINCT FROM p_exclude_desk
      AND d.user_id IS DISTINCT FROM p_exclude_user
      AND d.user_id IS DISTINCT FROM auth.uid()
      AND EXISTS (SELECT 1 FROM public.desk_photos AS dp WHERE dp.desk_id = d.id)
  )
  SELECT
    s.id,
    s.user_id,
    s.title,
    s.owner_name,
    s.owner_tag,
    s.owner_avatar_url,
    s.purposes,
    s.total_price,
    s.updated_at,
    s.content_updated_at,
    s.attributes,
    coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('id', dp.id, 'image_url', dp.image_url, 'sort_order', dp.sort_order)
        ORDER BY dp.sort_order, dp.id
      )
      FROM public.desk_photos AS dp
      WHERE dp.desk_id = s.id
    ), '[]'::jsonb) AS desk_photos,
    s.shared_gadgets
  FROM scored AS s
  WHERE s.shared_gadgets > 0 OR s.shared_purposes > 0
  ORDER BY s.shared_gadgets * 2 + s.shared_purposes DESC, s.updated_at DESC, s.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 12), 30));
$$;

REVOKE ALL ON FUNCTION public.list_similar_public_desks(TEXT[], TEXT[], TEXT[], UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_similar_public_desks(TEXT[], TEXT[], TEXT[], UUID, UUID, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
