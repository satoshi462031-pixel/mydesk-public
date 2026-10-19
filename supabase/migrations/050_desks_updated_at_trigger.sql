-- desks の更新時刻を進めるトリガが本番に存在しない。schema.sql にしか定義が
-- 無く、migrations 側で作り直していなかったため、schema.sql を流していない
-- 環境では updated_at が作成時のまま止まる。
-- みんなのデスクは updated_at の降順とキーセットページング（lt）で並ぶので、
-- 止まっていると事実上の作成順になり、更新しても先頭に来ない。
-- 閲覧数・いいねは 017 で撤去済みのため、desks への UPDATE はすべて
-- 内容の変更にあたる。列を限定せず BEFORE UPDATE でよい。

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desks_updated_at ON public.desks;
CREATE TRIGGER desks_updated_at
  BEFORE UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 既存行の updated_at は触らない。まとめて現在時刻にすると公開フィードの
-- 並びが一度に崩れる。

NOTIFY pgrst, 'reload schema';
