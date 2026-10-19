-- =============================================================
-- Migration 076: つなぎ方（線ごとに実物のケーブルを申告する）
--
-- 配線図の線は「HDMI で繋がっている」までしか言えない。実際に使っている1本
-- （機器に付属していたものか、選んで買ったものか）は、デスクを見る側が最も
-- 知りたい情報のひとつなのに、どこにも入る場所が無かった。
--
-- cables.md が削除した cableStatus（付属／手持ち／必要）と紛らわしいので線引きを書く。
-- あれは書き込むだけで線の描画にも公開ページにも出ず、実質が在庫メモだったから
-- 消された。この列は**公開デスクの線をタップすると出る**。表示先を消すなら、
-- この列も一緒に消すこと（在庫メモに戻る）。
--
-- 「未設定＝本体付属」とはしない。既定で付属と書くと、家にあった別の1本を
-- 使っている人のデスクにも「付属」と表示されて公開される。申告した線にだけ入れる。
-- =============================================================

ALTER TABLE public.connections
  ADD COLUMN IF NOT EXISTS cable_choice TEXT
    CHECK (cable_choice IS NULL OR cable_choice IN ('included', 'product')),
  ADD COLUMN IF NOT EXISTS cable_name TEXT
    CHECK (cable_name IS NULL OR char_length(cable_name) BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS cable_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.connections.cable_choice IS
  'つなぎ方の申告（076）。included=機器に付属していた1本 / product=選んだ商品。無申告は NULL';
COMMENT ON COLUMN public.connections.cable_name IS
  'cable_choice=product のときの商品名。公開ページはこの文字列をそのまま出す（商品DBを引き直さない）';
COMMENT ON COLUMN public.connections.cable_product_id IS
  '商品マスタへの参照。予測変換から選んだときだけ入る。商品からデスクを辿る導線に使う（073 と同じ考え方）';

-- ─── 公開時につなぎ方も運ぶ（075 の版に3列足しただけ）────
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
        cable_product_id
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
          THEN NULLIF(connection->>'cable_product_id', '')::UUID END
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
