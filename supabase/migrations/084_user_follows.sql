-- =============================================================
-- Migration 084: 投稿者のフォロー
--
-- 保存（bookmarks）がデスク1件を追うなら、こちらは人を追う。保存だけでは
-- 「その人が新しく公開したデスク」に気づく手段が無かった。
--
-- **集計は出さない。** フォロワー数は購入検証のない人気度になり、074 でブランドの
-- フォロー数を持たなかったのと同じ理由で持たない。誰が誰を追っているかも本人しか
-- 読めない（数えられる形で公開すると、RLS 越しに件数を数えれば同じことになる）。
--
-- 相手の識別は user_id。owner_tag は 060 から本人が変えられるので、キーにすると
-- タグを変えただけでフォローが外れる。表示名・タグ・アイコンは行に写さず、
-- 読むたびに相手の公開デスク（desks.owner_*）から引く。写しを持つと、
-- 相手がプロフィールを非公開にした後も名前が残り続ける。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT user_follows_not_self CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_created
  ON public.user_follows (follower_id, created_at DESC);

ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_follows FROM anon;

CREATE POLICY "user_follows_select_own" ON public.user_follows
  FOR SELECT TO authenticated USING (auth.uid() = follower_id);

CREATE POLICY "user_follows_insert_own" ON public.user_follows
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "user_follows_delete_own" ON public.user_follows
  FOR DELETE TO authenticated USING (auth.uid() = follower_id);

NOTIFY pgrst, 'reload schema';
