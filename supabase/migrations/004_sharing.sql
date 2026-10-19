-- =============================================================
-- 004_sharing.sql — デスク共有機能（閲覧数・いいね）
-- =============================================================

-- desks に view_count / like_count を追加
ALTER TABLE desks
  ADD COLUMN IF NOT EXISTS view_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count  INTEGER NOT NULL DEFAULT 0;

-- いいね管理テーブル（ユーザーごとの重複いいねを防ぐ）
CREATE TABLE IF NOT EXISTS likes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id    UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (desk_id, user_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_likes_desk_id ON likes(desk_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_desks_visibility ON desks(visibility);
CREATE INDEX IF NOT EXISTS idx_desks_like_count ON desks(like_count DESC);
CREATE INDEX IF NOT EXISTS idx_desks_view_count ON desks(view_count DESC);

-- =============================================================
-- RLS
-- =============================================================

ALTER TABLE likes ENABLE ROW LEVEL SECURITY;

-- 誰でも公開デスクのいいねを閲覧可能
DROP POLICY IF EXISTS "likes_select" ON likes;
CREATE POLICY "likes_select" ON likes FOR SELECT USING (
  EXISTS (SELECT 1 FROM desks WHERE desks.id = likes.desk_id AND desks.visibility = 'public')
);

-- 認証済みユーザーのみ自分のいいねを追加・削除可能
DROP POLICY IF EXISTS "likes_insert" ON likes;
CREATE POLICY "likes_insert" ON likes FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "likes_delete" ON likes;
CREATE POLICY "likes_delete" ON likes FOR DELETE USING (auth.uid() = user_id);

-- =============================================================
-- 閲覧数をインクリメントする RPC（RLS をバイパスして安全に加算）
-- =============================================================
CREATE OR REPLACE FUNCTION increment_view_count(p_desk_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE desks
  SET view_count = view_count + 1
  WHERE id = p_desk_id AND visibility = 'public';
END;
$$;

-- =============================================================
-- いいね時に like_count を同期するトリガー
-- =============================================================
CREATE OR REPLACE FUNCTION sync_like_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE desks SET like_count = like_count + 1 WHERE id = NEW.desk_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE desks SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.desk_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_like_count ON likes;
CREATE TRIGGER trg_sync_like_count
AFTER INSERT OR DELETE ON likes
FOR EACH ROW EXECUTE FUNCTION sync_like_count();
