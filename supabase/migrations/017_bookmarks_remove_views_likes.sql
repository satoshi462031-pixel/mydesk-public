-- =============================================================
-- 017_bookmarks_remove_views_likes.sql
--   閲覧数(view_count)・いいね(likes/like_count)機能を廃止し、
--   代わりにブックマーク機能（他ユーザーの公開デスクを自分専用に保存）を追加する。
-- =============================================================

-- ─── 1) 閲覧数・いいねの撤去 ─────────────────────────────────
DROP TRIGGER IF EXISTS desks_protect_counters ON public.desks;
DROP FUNCTION IF EXISTS public.protect_desk_counters();
DROP FUNCTION IF EXISTS public.increment_view_count(UUID);

DROP TRIGGER IF EXISTS trg_sync_like_count ON public.likes;
DROP FUNCTION IF EXISTS public.sync_like_count();

DROP TABLE IF EXISTS public.likes;

ALTER TABLE public.desks
  DROP COLUMN IF EXISTS view_count,
  DROP COLUMN IF EXISTS like_count;

-- ─── 2) ブックマーク機能の追加 ────────────────────────────────
-- 「いいね」と異なり件数は表示しない、ユーザー個人の保存機能のため
-- 集計カラム・カウンター保護トリガーは不要（likes テーブルより単純な構成）。
CREATE TABLE IF NOT EXISTS public.bookmarks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id    UUID NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (desk_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_desk_id ON public.bookmarks(desk_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON public.bookmarks(user_id);

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

-- 自分のブックマークだけ閲覧・追加・削除できる（他人には非公開）
DROP POLICY IF EXISTS "bookmarks_select" ON public.bookmarks;
CREATE POLICY "bookmarks_select" ON public.bookmarks FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "bookmarks_insert" ON public.bookmarks;
CREATE POLICY "bookmarks_insert" ON public.bookmarks FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.desks WHERE id = desk_id AND visibility = 'public')
);

DROP POLICY IF EXISTS "bookmarks_delete" ON public.bookmarks;
CREATE POLICY "bookmarks_delete" ON public.bookmarks FOR DELETE USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
