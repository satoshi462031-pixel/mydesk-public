-- ログインユーザー全員が最新1件を保持し、Proは復元用に直近7件を保持する。

DROP POLICY IF EXISTS "backups_insert" ON public.backups;
CREATE POLICY "backups_insert" ON public.backups
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.trim_backups()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  keep_count INT;
BEGIN
  keep_count := CASE WHEN public.is_pro_user(NEW.user_id) THEN 7 ELSE 1 END;

  DELETE FROM public.backups
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM public.backups
      WHERE user_id = NEW.user_id
      ORDER BY created_at DESC, id DESC
      LIMIT keep_count
    );
  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
