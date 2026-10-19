-- =============================================================
-- Migration 077: 同じ組み合わせを何本で繋いでいるか
--
-- ステレオの L/R（オーディオIF → パワードスピーカーに TRS 2本）とデュアル電源の PC は、
-- 同じ2台を同じ種別のケーブル2本で繋ぐ。配線図はこれを線2本では持てない
-- （pairKey(from, to, cable_type) を前提にした引き継ぎが同じキーの線を区別できず、
-- 端末側ではプランを読み直すたびに片方が黙って消えていた）。本数として持つ。
--
-- 公開ページでは線に「×2」と出る。1本の線には入れない（既定 1）。
-- =============================================================

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS cable_count SMALLINT NOT NULL DEFAULT 1
    CHECK (cable_count BETWEEN 1 AND 8);

COMMENT ON COLUMN public.connections.cable_count IS
  '同じ2台を同じ種別で繋いでいる本数（077）。ステレオの L/R・デュアル電源。既定は1';

-- ─── 公開時に本数も運ぶ（076 の版に1列足しただけ）────
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
    INSERT INTO public.devices (
      desk_id, name, category, price, ports, purchased_at, removed_at, product_id,
      brand, brand_aliases
    )
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
      NULLIF(device->>'product_id', '')::UUID,
      -- ブランドが引けない機材（「モニターアーム」等の一般名）は NULL のまま。
      -- 長さは端末側の辞書に無いブランドが入りうるので切っておく
      LEFT(NULLIF(device->>'brand', ''), 80),
      CASE
        WHEN jsonb_typeof(device->'brand_aliases') = 'array'
          THEN ARRAY(
            SELECT LEFT(alias.value, 80)
            FROM jsonb_array_elements_text(device->'brand_aliases') AS alias(value)
            WHERE alias.value <> ''
            LIMIT 12
          )
        ELSE NULL
      END
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
        branch_group_id,
        cable_choice,
        cable_name,
        cable_product_id,
        cable_count
      )
      VALUES (
        p_desk_id,
        (device_ids->>(connection->>'from_local_id'))::UUID,
        (device_ids->>(connection->>'to_local_id'))::UUID,
        connection->>'cable_type',
        LEFT(NULLIF(connection->>'branch_group_id', ''), 64),
        -- 知らない値は捨てて NULL にする。CHECK で公開そのものを失敗させると、
        -- 新しい種類を足した端末から古いサーバーへ公開したときにデスク全体が出せなくなる
        CASE WHEN connection->>'cable_choice' IN ('included', 'product')
          THEN connection->>'cable_choice' END,
        CASE WHEN connection->>'cable_choice' = 'product'
          THEN LEFT(NULLIF(connection->>'cable_name', ''), 120) END,
        CASE WHEN connection->>'cable_choice' = 'product'
          THEN NULLIF(connection->>'cable_product_id', '')::UUID END,
        -- 本数も同じ考え方で、範囲外は既定の1本に丸める（公開を失敗させない）
        LEAST(GREATEST(COALESCE(NULLIF(connection->>'cable_count', '')::SMALLINT, 1), 1), 8)
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

NOTIFY pgrst, 'reload schema';
