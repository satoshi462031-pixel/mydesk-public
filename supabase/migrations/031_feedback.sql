-- アプリ内フィードバック。
-- メールに飛ばすと送信率が落ちるので、アプリ内で完結させて Supabase に貯める。
-- 運用はテーブルを直接見る（件数が増えたら管理画面を検討）。

CREATE TABLE IF NOT EXISTS public.feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ログイン前でも送れるようにする。不具合はログインできない状況でこそ届いてほしい
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category    TEXT NOT NULL CHECK (category IN ('bug', 'request', 'other')),
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  -- 再現に要る環境情報だけ。端末を特定できる識別子は持たない
  app_version TEXT,
  platform    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON public.feedback(created_at DESC);

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- 送信は誰でも可（匿名も含む）。ただし user_id を詐称できないよう、
-- ログイン中は自分のIDか NULL しか入れられない
DROP POLICY IF EXISTS "feedback_insert" ON public.feedback;
CREATE POLICY "feedback_insert"
  ON public.feedback FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- 読めるのは自分が送ったものだけ。他人のフィードバックは見えない
DROP POLICY IF EXISTS "feedback_select_own" ON public.feedback;
CREATE POLICY "feedback_select_own"
  ON public.feedback FOR SELECT
  USING (user_id IS NOT NULL AND user_id = auth.uid());

-- 更新・削除は誰にも許可しない（ポリシーを作らない＝拒否）。
-- 送信後に書き換えられると報告の内容が信用できなくなる

GRANT INSERT ON public.feedback TO anon, authenticated;
GRANT SELECT ON public.feedback TO authenticated;
