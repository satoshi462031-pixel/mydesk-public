-- 108_orphan_user_logs.sql
--
-- 106 で足した2つの記録表は auth.users を参照しておらず、アカウントを削除しても
-- 利用者 ID の行が残り続けていた。ほかの利用者ごとの表（040 番台以降）はすべて
-- ON DELETE CASCADE で一緒に消える。
--
--   desk_creation_log       … 作成の回数制限に直近1日分しか使わないのに、作るたびに1行ずつ溜まる
--   follower_push_owner_log … フォロワーへの通知の間隔。1人1行
--
-- desks を参照しないのは 106 のとおり（消して作り直す回数を数えるため）。参照先を
-- auth.users にすれば、デスクを消しても記録は残り、アカウントを消せば消える。

-- 既にアカウントが消えている行は外部キーを張れないので先に消す
DELETE FROM public.desk_creation_log l
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id);
DELETE FROM public.follower_push_owner_log l
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.user_id);

ALTER TABLE public.desk_creation_log
  ADD CONSTRAINT desk_creation_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.follower_push_owner_log
  ADD CONSTRAINT follower_push_owner_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 回数制限が見るのは直近1日だけ。それより古い行は使い道が無い
DELETE FROM public.desk_creation_log WHERE created_at < now() - INTERVAL '1 day';

-- 作るたびに、本人の1日より古い記録を片付ける（106 の本体に1文足しただけ）
CREATE OR REPLACE FUNCTION public.guard_desk_creation()
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
  DELETE FROM public.desk_creation_log
  WHERE user_id = v_uid AND created_at < v_now - INTERVAL '1 day';
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

NOTIFY pgrst, 'reload schema';
