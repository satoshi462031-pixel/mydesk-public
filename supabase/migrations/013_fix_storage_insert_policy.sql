-- 公開時の写真アップロードが "new row violates row-level security policy" で
-- 失敗する問題の修正。
--
-- 旧ポリシーは auth.role() = 'authenticated' を条件にしていたが、
-- auth.role() は非推奨で、Supabase の JWT 取り扱いが変わった環境では NULL を返す。
-- その結果 WITH CHECK が false になり INSERT が拒否される。
-- auth.uid() の一致チェックだけで「認証済み かつ 自分のフォルダ」を担保できるため、
-- role の判定は落とす。

DROP POLICY IF EXISTS "desk_images_auth_insert" ON storage.objects;
CREATE POLICY "desk_images_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "desk_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "desk_images_owner_read" ON storage.objects;
CREATE POLICY "desk_images_owner_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "desk_images_own_delete" ON storage.objects;
CREATE POLICY "desk_images_own_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- アバター再アップロード（upsert: true）に必要
DROP POLICY IF EXISTS "desk_images_own_update" ON storage.objects;
CREATE POLICY "desk_images_own_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- バケットが無い環境向け（既にあれば何もしない）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('desk-images', 'desk-images', true, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
