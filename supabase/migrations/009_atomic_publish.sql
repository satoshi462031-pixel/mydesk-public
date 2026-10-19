-- 公開デスクの構成・写真を、閲覧者に途中状態を見せず置換する。

CREATE OR REPLACE FUNCTION replace_published_desk_content(
  p_desk_id UUID,
  p_devices JSONB,
  p_connections JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device JSONB;
  connection JSONB;
  new_device_id UUID;
  device_ids JSONB := '{}'::JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desks WHERE id = p_desk_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'desk not found or not owned by current user';
  END IF;

  DELETE FROM connections WHERE desk_id = p_desk_id;
  DELETE FROM devices WHERE desk_id = p_desk_id;

  FOR device IN SELECT value FROM jsonb_array_elements(COALESCE(p_devices, '[]'::JSONB)) LOOP
    INSERT INTO devices (desk_id, name, category, price, ports, purchased_at, removed_at)
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
      INSERT INTO connections (desk_id, from_device_id, to_device_id, cable_type)
      VALUES (
        p_desk_id,
        (device_ids->>(connection->>'from_local_id'))::UUID,
        (device_ids->>(connection->>'to_local_id'))::UUID,
        connection->>'cable_type'
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION replace_desk_photos(p_desk_id UUID, p_image_urls JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  image_url TEXT;
  sort_index INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desks WHERE id = p_desk_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'desk not found or not owned by current user';
  END IF;

  DELETE FROM desk_photos WHERE desk_id = p_desk_id;
  FOR image_url IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_image_urls, '[]'::JSONB)) LOOP
    INSERT INTO desk_photos (desk_id, image_url, sort_order) VALUES (p_desk_id, image_url, sort_index);
    sort_index := sort_index + 1;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION replace_published_desk_content(UUID, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION replace_desk_photos(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_published_desk_content(UUID, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_desk_photos(UUID, JSONB) TO authenticated;
