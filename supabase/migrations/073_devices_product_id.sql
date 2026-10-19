-- =============================================================
-- Migration 073: 機材から公開デスクを辿れるようにする
--
-- 「このモニターを使っているデスク」を出すための土台。人単位（/u/:tag）より
-- 入口が広く、デスクを持っていない人・投稿しない人にも用がある。
--
-- 突き合わせに名前は使わない。「Dell U2723QE」と「DELL U2723QE 27インチ」が
-- 別物になり、この機能の信頼を最初に落とす。端末側の Gadget は商品マスタへの
-- 参照（productId）を持っているのに、公開時に落としていた。それを運ぶ。
--
-- 番号が 073 なのは、066 を gadget_bookmarks が使っているため。版＝先頭の数字は
-- schema_migrations の主キーで、重複すると db push がそこで止まる（061 の冒頭に
-- 同じ事故の記録がある）。内容の依存は無いので後ろへ動かして構わない。
--
-- 073 より前に公開されたデスクは product_id が空のまま。埋め直す手段は無い
-- （対応は端末側にしかない）ので、次に公開し直したデスクから埋まる。
-- =============================================================

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.devices.product_id IS
  '商品マスタへの参照。予測変換で商品を選んだ機材にだけ入る。機材から公開デスクを辿るのに使う';

-- 機材から引く索引。デスクから引く既存の経路（desk_id）とは別方向
CREATE INDEX IF NOT EXISTS devices_product_id_idx
  ON public.devices (product_id)
  WHERE product_id IS NOT NULL;

-- ─── 1) 公開時に product_id も運ぶ（064 の版に1列足しただけ）────
CREATE OR REPLACE FUNCTION public.publish_desk_snapshot(
  p_desk_id UUID,
  p_devices JSONB,
  p_connections JSONB,
  p_image_urls JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device JSONB;
  connection JSONB;
  image_url TEXT;
  new_device_id UUID;
  device_ids JSONB := '{}'::JSONB;
  sort_index INTEGER := 0;
  v_uid UUID := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.desks WHERE id = p_desk_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'desk not found or not owned by current user';
  END IF;

  DELETE FROM public.connections WHERE desk_id = p_desk_id;
  DELETE FROM public.devices WHERE desk_id = p_desk_id;

  FOR device IN SELECT value FROM jsonb_array_elements(COALESCE(p_devices, '[]'::JSONB)) LOOP
    INSERT INTO public.devices (desk_id, name, category, price, ports, purchased_at, removed_at, product_id)
    VALUES (
      p_desk_id,
      device->>'name',
      device->>'category',
      NULLIF(device->>'price', '')::INTEGER,
      COALESCE(device->'ports', '[]'::JSONB),
      NULLIF(device->>'purchased_at', '')::DATE,
      NULLIF(device->>'removed_at', '')::DATE,
      -- 商品マスタに無い機材（手入力）は NULL のまま。機材から辿る導線は
      -- 商品が特定できているものだけを対象にする（名前一致は別物を混ぜるので使わない）
      NULLIF(device->>'product_id', '')::UUID
    )
    RETURNING id INTO new_device_id;
    device_ids := device_ids || jsonb_build_object(device->>'local_id', new_device_id);
  END LOOP;

  FOR connection IN SELECT value FROM jsonb_array_elements(COALESCE(p_connections, '[]'::JSONB)) LOOP
    IF device_ids ? (connection->>'from_local_id') AND device_ids ? (connection->>'to_local_id') THEN
      INSERT INTO public.connections (
        desk_id,
        from_device_id,
        to_device_id,
        cable_type,
        branch_group_id
      )
      VALUES (
        p_desk_id,
        (device_ids->>(connection->>'from_local_id'))::UUID,
        (device_ids->>(connection->>'to_local_id'))::UUID,
        connection->>'cable_type',
        LEFT(NULLIF(connection->>'branch_group_id', ''), 64)
      );
    END IF;
  END LOOP;

  DELETE FROM public.desk_photos WHERE desk_id = p_desk_id;
  FOR image_url IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_image_urls, '[]'::JSONB)) LOOP
    IF NOT public.is_own_public_image_url(image_url, v_uid, p_desk_id::TEXT) THEN
      RAISE EXCEPTION 'desk photo must be an uploaded image owned by the caller' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.desk_photos (desk_id, image_url, sort_order)
    VALUES (p_desk_id, image_url, sort_index);
    sort_index := sort_index + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB)
  TO authenticated;

-- ─── 2) その商品を使っている公開デスク ──────────────────────────
-- 戻す列は search_public_desks（055/065）と揃える。呼ぶ側が同じタイルへ流し込めるようにする。
-- SECURITY INVOKER のままにして、desks / devices / desk_photos の RLS を迂回しない。
CREATE OR REPLACE FUNCTION public.public_desks_using_product(
  p_product_id UUID,
  p_limit INTEGER DEFAULT 20
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
    d.id, d.user_id, d.title, d.owner_name, d.owner_tag, d.owner_avatar_url,
    d.purposes, d.total_price, d.updated_at, d.content_updated_at, d.attributes,
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
    AND p_product_id IS NOT NULL
    -- 同じデスクに同じ商品が複数台あっても1行にする
    AND EXISTS (
      SELECT 1 FROM public.devices AS dev
      WHERE dev.desk_id = d.id AND dev.product_id = p_product_id
    )
  ORDER BY d.updated_at DESC, d.id DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 50));
$$;

REVOKE ALL ON FUNCTION public.public_desks_using_product(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_desks_using_product(UUID, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
