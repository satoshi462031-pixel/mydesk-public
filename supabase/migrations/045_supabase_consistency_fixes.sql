-- 公開スナップショットの枝情報欠落と、バックアップ容量制限のDB迂回を修正する。

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
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.desks WHERE id = p_desk_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'desk not found or not owned by current user';
  END IF;

  DELETE FROM public.connections WHERE desk_id = p_desk_id;
  DELETE FROM public.devices WHERE desk_id = p_desk_id;

  FOR device IN SELECT value FROM jsonb_array_elements(COALESCE(p_devices, '[]'::JSONB)) LOOP
    INSERT INTO public.devices (desk_id, name, category, price, ports, purchased_at, removed_at)
    VALUES (
      p_desk_id,
      device->>'name',
      device->>'category',
      NULLIF(device->>'price', '')::INTEGER,
      COALESCE(device->'ports', '[]'::JSONB),
      NULLIF(device->>'purchased_at', '')::DATE,
      NULLIF(device->>'removed_at', '')::DATE
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

-- クライアントの4MB制限はAPI直呼びで迂回できるため、DBでも新規行を制限する。
-- NOT VALIDでも追加後のINSERT/UPDATEには適用され、既存行の全表走査だけを避けられる。
ALTER TABLE public.backups
  ADD CONSTRAINT backups_payload_max_bytes
  CHECK (octet_length(payload::TEXT) <= 4194304) NOT VALID;

ALTER TABLE public.backups
  ADD CONSTRAINT backups_reported_size_range
  CHECK (byte_size BETWEEN 0 AND 4194304) NOT VALID;

NOTIFY pgrst, 'reload schema';
