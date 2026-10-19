-- =============================================================
-- 030_ugc_moderation.sql — 公開デスクの通報とユーザーブロック
--
-- App Store ガイドライン 1.2（ユーザー生成コンテンツ）は、他人の投稿を
-- アプリ内で閲覧できる場合に「不適切なコンテンツの通報手段」と
-- 「迷惑ユーザーのブロック機能」を必須にしている。PublicDeskScreen /
-- BookmarkListScreen で他人の公開デスクを閲覧できるため、両方が必要。
-- =============================================================

-- ─── 通報 ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id     UUID NOT NULL REFERENCES public.desks(id)  ON DELETE CASCADE,
  reporter_id UUID NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  reason      TEXT NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'infringement', 'other')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 同じデスクへの連投を防ぐ。取り下げの概念は持たせない
  UNIQUE (desk_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS desk_reports_desk_idx ON public.desk_reports (desk_id, created_at DESC);

ALTER TABLE public.desk_reports ENABLE ROW LEVEL SECURITY;

-- 通報された側に通報の存在を知られてはいけないので、SELECT は通報者本人のみ。
-- 運用者は service_role（RLS を通らない）でダッシュボードから確認する。
DROP POLICY IF EXISTS desk_reports_insert_own ON public.desk_reports;
CREATE POLICY desk_reports_insert_own
  ON public.desk_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS desk_reports_select_own ON public.desk_reports;
CREATE POLICY desk_reports_select_own
  ON public.desk_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

-- ─── ブロック ───────────────────────────────────────────────────
-- blocked_name は表示用のスナップショット。profiles は他人の行を読めないため、
-- 解除画面で名前を出すには保存時に控えておく必要がある。
CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- 自分がブロックした行だけを読み書きできる。
-- ブロックされた側からは自分がブロックされたことを一切観測できない。
DROP POLICY IF EXISTS blocked_users_own ON public.blocked_users;
CREATE POLICY blocked_users_own
  ON public.blocked_users FOR ALL
  TO authenticated
  USING (blocker_id = auth.uid())
  WITH CHECK (blocker_id = auth.uid());

NOTIFY pgrst, 'reload schema';
