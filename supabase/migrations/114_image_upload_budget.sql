CREATE TABLE account_security.image_upload_usage (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  uploads INTEGER NOT NULL,
  bytes BIGINT NOT NULL
);
ALTER TABLE account_security.image_upload_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security.image_upload_usage FROM PUBLIC, anon, authenticated;

-- Storageの権限検査はロールバックされるため、予算は画像ゲートウェイが転送前に確保する。
CREATE FUNCTION public.reserve_image_upload(p_user_id UUID, p_bytes BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_day DATE := (statement_timestamp() AT TIME ZONE 'UTC')::DATE;
BEGIN
  IF p_user_id IS NULL OR p_bytes IS NULL OR p_bytes < 1 OR p_bytes > 5242880 THEN
    RAISE EXCEPTION 'INVALID_IMAGE_UPLOAD' USING ERRCODE = '22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('image_upload:' || p_user_id::TEXT, 0)) THEN
    RAISE EXCEPTION 'IMAGE_UPLOAD_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM storage.objects
      WHERE bucket_id = 'desk-images' AND name LIKE p_user_id::TEXT || '/%' LIMIT 4000) owned) >= 4000 THEN
    RAISE EXCEPTION 'IMAGE_UPLOAD_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO account_security.image_upload_usage(user_id, day, uploads, bytes)
  VALUES (p_user_id, v_day, 1, p_bytes)
  ON CONFLICT (user_id) DO UPDATE SET
    day = EXCLUDED.day,
    uploads = CASE WHEN image_upload_usage.day = EXCLUDED.day THEN image_upload_usage.uploads + 1 ELSE 1 END,
    bytes = CASE WHEN image_upload_usage.day = EXCLUDED.day THEN image_upload_usage.bytes + EXCLUDED.bytes ELSE EXCLUDED.bytes END
  WHERE image_upload_usage.day <> EXCLUDED.day OR
    (image_upload_usage.uploads < 600 AND image_upload_usage.bytes + EXCLUDED.bytes <= 1073741824);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IMAGE_UPLOAD_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_image_upload(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_image_upload(UUID, BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';
