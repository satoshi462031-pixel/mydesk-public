-- =============================================================
-- Migration 086: 自分の公開デスクへの反応（いいね・保存）の件数
--
-- いいねは「いいと思った」印で、投稿者に届いてこそ意味がある。これまで件数は
-- 公開ページの下のバーにしか出ず、投稿者が気づく道がほとんど無かった。
-- 保存は「継続的に見たい」印。誰が保存したかは本人しか読めない（017 の RLS）ままにして、
-- 件数だけを持ち主に返す。
--
-- 返すのは呼び出した本人のデスクだけ。誰が押したか・保存したかは返さない。
-- p_since より後のいいねを new_like_count に数える（ベルの「反応」に使う）。
-- 自分で自分のデスクに付けたものは数えない。
-- checked_at はサーバー時刻。既読の基準に端末の時計を使うと、ずれのぶん判定が狂う。
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_my_desk_reactions(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
  desk_id        UUID,
  title          TEXT,
  like_count     INTEGER,
  bookmark_count INTEGER,
  new_like_count INTEGER,
  checked_at     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    d.like_count,
    (SELECT COUNT(*)::INTEGER FROM public.bookmarks b
      WHERE b.desk_id = d.id AND b.user_id <> d.user_id),
    CASE WHEN p_since IS NULL THEN 0 ELSE
      (SELECT COUNT(*)::INTEGER FROM public.likes l
        WHERE l.desk_id = d.id AND l.user_id <> d.user_id AND l.created_at > p_since)
    END,
    now()
  FROM public.desks d
  WHERE d.user_id = auth.uid()
    AND d.visibility IN ('public', 'unlisted');
$$;

REVOKE ALL ON FUNCTION public.get_my_desk_reactions(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_desk_reactions(TIMESTAMPTZ) TO authenticated;

-- 新しいいいねの数え上げ（desk_id と時刻で絞る）
CREATE INDEX IF NOT EXISTS idx_likes_desk_created ON public.likes (desk_id, created_at);

NOTIFY pgrst, 'reload schema';
