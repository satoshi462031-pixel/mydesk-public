-- 公開デスクへの「いいね」。ブックマークとは分離し、件数だけを公開する。

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0 CHECK (like_count >= 0);

CREATE TABLE IF NOT EXISTS public.likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id    UUID NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (desk_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_user_created
  ON public.likes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_desk_id
  ON public.likes(desk_id);

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

-- 誰がどのデスクを評価したかは本人だけが読める。公開するのは desks.like_count のみ。
DROP POLICY IF EXISTS "likes_select_own" ON public.likes;
CREATE POLICY "likes_select_own" ON public.likes
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "likes_insert_own" ON public.likes;
CREATE POLICY "likes_insert_own" ON public.likes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.desks
      WHERE id = desk_id
        AND visibility = 'public'
        AND user_id <> auth.uid()
    )
  );

DROP POLICY IF EXISTS "likes_delete_own" ON public.likes;
CREATE POLICY "likes_delete_own" ON public.likes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.likes FROM anon;
GRANT SELECT, INSERT, DELETE ON public.likes TO authenticated;

-- デスク所有者が公開カウンターを直接書き換えられないようにする。
CREATE OR REPLACE FUNCTION public.protect_desk_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.bypass_like_count_protection', true) IS DISTINCT FROM 'on' THEN
    NEW.like_count := OLD.like_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desks_protect_like_count ON public.desks;
CREATE TRIGGER desks_protect_like_count
  BEFORE UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.protect_desk_like_count();

-- いいね数だけの変化では「デスクが更新された」と扱わない。
-- フィードの並び順や保存一覧の更新表示を動かさないため。
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at' - 'like_count')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'like_count') THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_desk_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.bypass_like_count_protection', 'on', true);
  IF TG_OP = 'INSERT' THEN
    UPDATE public.desks
    SET like_count = like_count + 1
    WHERE id = NEW.desk_id;
  ELSE
    UPDATE public.desks
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.desk_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS likes_sync_desk_count ON public.likes;
CREATE TRIGGER likes_sync_desk_count
  AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_desk_like_count();

NOTIFY pgrst, 'reload schema';
