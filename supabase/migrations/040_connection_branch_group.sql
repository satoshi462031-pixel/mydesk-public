-- 2in1・3in1 ケーブルの枝を公開デスクでも束ねて描くための列。
-- 同じ値を持つ配線は1本の物理ケーブルで、閲覧側は同値比較にしか使わない
-- （表示はしない）。長さは配線図が生成する識別子（branch-<接続ID>）に十分な範囲へ制限する。

ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS branch_group_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'connections_branch_group_id_len'
  ) THEN
    ALTER TABLE connections
      ADD CONSTRAINT connections_branch_group_id_len
      CHECK (branch_group_id IS NULL OR char_length(branch_group_id) <= 64);
  END IF;
END $$;

-- 公開時の置換RPC。009 / 010 と同じ内容に branch_group_id の受け渡しだけを足す。
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
      INSERT INTO connections (desk_id, from_device_id, to_device_id, cable_type, branch_group_id)
      VALUES (
        p_desk_id,
        (device_ids->>(connection->>'from_local_id'))::UUID,
        (device_ids->>(connection->>'to_local_id'))::UUID,
        connection->>'cable_type',
        LEFT(NULLIF(connection->>'branch_group_id', ''), 64)
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION replace_published_desk_content(UUID, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_published_desk_content(UUID, JSONB, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
