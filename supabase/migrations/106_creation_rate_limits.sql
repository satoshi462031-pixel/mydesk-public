-- 106_creation_rate_limits.sql
--
-- 数の上限が無かった書き込みを、普通の使い方では当たらない値で止める。
-- 無料の上限（デスク3つ・写真4枚）はアプリ側にしか無く、REST を直接叩けば
-- いくらでも作れた。作り放題だと次の攻撃が成り立つ。
--   1) デスクを作っては消すたびに「新しいデスクを公開」の通知がフォロワー全員へ飛ぶ
--      （desk_push_log はデスクごとなので、作り直すと間隔の記録ごと消える）
--   2) みんなのデスクを大量のデスクで埋める
--   3) desk-images へ 5MB のファイルを際限なく上げ、ストレージの容量と料金を食わせる
--
-- 通知の持ち主ごとの間隔は notify-followers が follower_push_owner_log で見る。

-- ─── 1) デスクの作成 ─────────────────────────────────────────
-- 消して作り直すと desks の行を数えても抜けるので、作成の記録は別の表に残す
-- （desks を参照しない。ON DELETE CASCADE で一緒に消えると意味が無い）
CREATE TABLE public.desk_creation_log (
  user_id    UUID        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX desk_creation_log_user_created_idx ON public.desk_creation_log (user_id, created_at DESC);
ALTER TABLE public.desk_creation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.desk_creation_log FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.guard_desk_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := statement_timestamp();
BEGIN
  -- 管理スクリプト（service_role）は対象外
  IF COALESCE(auth.role(), '') <> 'authenticated' OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  -- 公式アカウント（090）はデモデスクをまとめて公開する
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND is_official) THEN
    RETURN NEW;
  END IF;

  -- 同時に投げられても数え漏れないよう、本人の作成を1本ずつにする
  PERFORM pg_advisory_xact_lock(hashtextextended('desk_creation:' || v_uid::TEXT, 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM public.desk_creation_log
        WHERE user_id = v_uid AND created_at >= v_now - INTERVAL '1 day'
        LIMIT 20) recent) >= 20
     OR (SELECT count(*) FROM (
        SELECT 1 FROM public.desks WHERE user_id = v_uid LIMIT 100) owned) >= 100 THEN
    RAISE EXCEPTION 'CREATION_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;

  -- NEW.user_id が本人でなければ、この後の RLS で挿入ごと取り消され、記録も残らない
  INSERT INTO public.desk_creation_log (user_id, created_at) VALUES (v_uid, v_now);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_desk_creation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_desk_creation
  BEFORE INSERT ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.guard_desk_creation();

-- ─── 2) 写真の保存 ───────────────────────────────────────────
-- 1枚の公開で原寸・中・サムネの3ファイルになる。10デスク×10枚を1日で入れ直しても300なので、
-- 1日600・合計4000で普通の使い方には当たらない。消して上げ直す分は容量を食わないので、
-- 今ある行だけを数えればよい
CREATE FUNCTION public.desk_images_upload_allowed()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_official)
    OR (
      (SELECT count(*) FROM (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'desk-images'
          AND name LIKE auth.uid()::TEXT || '/%'
          AND created_at >= now() - INTERVAL '1 day'
        LIMIT 600) recent) < 600
      AND (SELECT count(*) FROM (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'desk-images'
          AND name LIKE auth.uid()::TEXT || '/%'
        LIMIT 4000) owned) < 4000
    )
  );
$$;
REVOKE ALL ON FUNCTION public.desk_images_upload_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_images_upload_allowed() TO authenticated;

-- 既存の desk_images_auth_insert（013）と AND で効かせる
DROP POLICY IF EXISTS "desk_images_upload_quota" ON storage.objects;
CREATE POLICY "desk_images_upload_quota" ON storage.objects
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'desk-images' OR public.desk_images_upload_allowed());

-- ─── 3) フォロワーへの通知の持ち主ごとの間隔 ──────────────────────
-- 書くのは notify-followers（service_role）だけ
CREATE TABLE public.follower_push_owner_log (
  user_id      UUID        PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.follower_push_owner_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.follower_push_owner_log FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
