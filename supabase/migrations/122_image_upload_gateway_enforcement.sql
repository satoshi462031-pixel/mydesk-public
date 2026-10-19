-- 114・upload-desk-image・対応アプリの配布を済ませてから、直接書き込みを閉じる。
DROP POLICY IF EXISTS desk_images_upload_quota ON storage.objects;
CREATE POLICY desk_images_upload_gateway ON storage.objects AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (bucket_id <> 'desk-images');
CREATE POLICY desk_images_update_gateway ON storage.objects AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (bucket_id <> 'desk-images') WITH CHECK (bucket_id <> 'desk-images');
NOTIFY pgrst, 'reload schema';
