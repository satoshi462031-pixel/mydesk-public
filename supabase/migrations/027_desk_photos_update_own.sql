-- =============================================================
-- 027_desk_photos_update_own.sql
--   公開を取り消したときに写真の公開URLを失効させるための UPDATE ポリシー。
--
--   desk-images は public バケットで、/object/public/... は RLS を通らない。
--   そのため visibility を private に戻しても、公開中に出回った写真URLは
--   そのまま取得できてしまっていた（バケットを private にすると公開ページの
--   表示経路をすべて署名付きURLに作り替える必要があるため、ここでは
--   「公開を取り消した時点でパスを振り直して旧URLを 404 にする」方式を採る）。
--
--   services/publishService.ts の revokePublishedPhotoUrls() が
--   Storage 側で move したあと、desk_photos.image_url を書き換える。
--   これまで desk_photos には INSERT / SELECT / DELETE のポリシーしか無く、
--   UPDATE は既定拒否だった。
--
--   条件は他のポリシーと同じ「その desk の所有者だけ」。USING を省略した
--   WITH CHECK は Postgres が USING と同じ式を使うため、他人の desk へ
--   付け替えることはできない。
-- =============================================================

DROP POLICY IF EXISTS "desk_photos_update_own" ON public.desk_photos;
CREATE POLICY "desk_photos_update_own"
  ON public.desk_photos FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
