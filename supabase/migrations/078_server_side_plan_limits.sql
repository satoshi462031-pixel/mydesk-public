-- =============================================================
-- 078_server_side_plan_limits.sql
--   Pro の上限のうち、アプリの中でしか守っていなかったものをサーバーでも守る。
--   改造したアプリから直接挿入すると、どちらも際限なく積めた
--   （desk_versions の挿入は所有者だけ、publish_desk_snapshot は枚数を見ていなかった）。
--
--   ・成長記録（desk_versions）：Free はデスクごとに 10 件まで
--     （PLAN_LIMITS.free.maxGrowthRecords。アプリも上限に達したら記録しないので挙動は変わらない）
--   ・公開写真（desk_photos）：デスクごとに 10 枚まで（PLAN_LIMITS.pro.maxPhotosPerDesk）
--     写真は Free / Pro で分けない。Pro の間に 10 枚入れたデスクを解約後に公開し直したとき、
--     Free の 4 枚で弾くと公開そのものができなくなる。写真を足せるかの線引きはアプリ側
--     （追加の操作）が持ち、ここでは上限そのものを越える投入だけを止める。
--
--   同じデスクへの同時挿入で上限をすり抜けないよう、デスクの行をロックしてから数える。
-- =============================================================

CREATE OR REPLACE FUNCTION public.enforce_desk_version_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT user_id INTO v_owner FROM public.desks WHERE id = NEW.desk_id FOR UPDATE;
  -- デスクが無い挿入は外部キーと RLS が弾く。Pro は無制限（is_pro_user は期限切れの猶予も見る）
  IF v_owner IS NULL OR public.is_pro_user(v_owner) THEN
    RETURN NEW;
  END IF;
  IF (SELECT count(*) FROM public.desk_versions WHERE desk_id = NEW.desk_id) >= 10 THEN
    RAISE EXCEPTION 'growth record limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_desk_version_limit ON public.desk_versions;
CREATE TRIGGER trg_enforce_desk_version_limit
  BEFORE INSERT ON public.desk_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_desk_version_limit();

CREATE OR REPLACE FUNCTION public.enforce_desk_photo_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.desks WHERE id = NEW.desk_id FOR UPDATE;
  -- publish_desk_snapshot は同じトランザクションで消してから1枚ずつ入れ直すので、数は常に今の枚数
  IF (SELECT count(*) FROM public.desk_photos WHERE desk_id = NEW.desk_id) >= 10 THEN
    RAISE EXCEPTION 'desk photo limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_desk_photo_limit ON public.desk_photos;
CREATE TRIGGER trg_enforce_desk_photo_limit
  BEFORE INSERT ON public.desk_photos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_desk_photo_limit();

NOTIFY pgrst, 'reload schema';
