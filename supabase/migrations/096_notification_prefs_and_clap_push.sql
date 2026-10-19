-- =============================================================
-- Migration 096: 通知の種類ごとのオン・オフ、フォローした人ごとのオン・オフ、
--                拍手の通知（notify-claps）の送信記録
--
-- 拍手（095）はベルにしか届かず、アプリを開かない投稿者は反響に気づけない。
-- 更新 → 拍手 → 投稿者に届く、の最後が切れていると循環が回らないので、
-- 拍手を iPhone の通知で届ける。通知が2種類になるので、種類ごとに止められるようにする。
--
-- 設定は端末ではなくアカウントに持つ。送るかを決めるのはサーバー（Edge Function）で、
-- 端末の中の設定は送る側から見えない。行が無い人は両方オン（既定）として扱う。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- フォロー中の人のデスクの公開・更新（085）
  follow_updates BOOLEAN NOT NULL DEFAULT TRUE,
  -- 自分のデスクへの拍手（096）
  claps          BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_prefs_select_own" ON public.notification_prefs;
CREATE POLICY "notification_prefs_select_own" ON public.notification_prefs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_prefs_insert_own" ON public.notification_prefs;
CREATE POLICY "notification_prefs_insert_own" ON public.notification_prefs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_prefs_update_own" ON public.notification_prefs;
CREATE POLICY "notification_prefs_update_own" ON public.notification_prefs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.notification_prefs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO authenticated;

-- ─── 拍手の通知の送信記録 ──────────────────────────────────────
-- 持ち主ごとに1行。拍手が続くたびに通知が鳴ると、反響ではなく騒音になるので、
-- 同じ人へは間を空ける（間隔は notify-claps/decide.ts）。
-- デスクごとではなく人ごとにするのは、デスクを複数公開している人ほど鳴り続けるのを防ぐため。
-- サービスロール（Edge Function）だけが読み書きする
CREATE TABLE IF NOT EXISTS public.clap_push_log (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.clap_push_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clap_push_log FROM anon, authenticated;

-- ─── フォローした人ごとのオン・オフ ─────────────────────────────
-- 追っていたいが、通知までは要らない人がいる。フォローを外すと更新一覧（ベル）からも
-- 消えるので、通知だけを止められるようにする。種類ごとの設定（follow_updates）が
-- オフなら、こちらがオンでも届かない
ALTER TABLE public.user_follows
  ADD COLUMN IF NOT EXISTS notify BOOLEAN NOT NULL DEFAULT TRUE;

-- 本人が書き換えてよいのは notify だけ。相手（followee_id）を書き換えられると、
-- 行を消さずに別の人のフォローへ付け替えられる
DROP POLICY IF EXISTS "user_follows_update_own" ON public.user_follows;
CREATE POLICY "user_follows_update_own" ON public.user_follows
  FOR UPDATE TO authenticated
  USING (auth.uid() = follower_id)
  WITH CHECK (auth.uid() = follower_id);

-- Supabase は public の表に authenticated への全列の UPDATE を既定で付けている。
-- 列の GRANT を足すだけでは既定の付与が残るので、表単位の UPDATE を外してから列で付け直す
REVOKE UPDATE ON public.user_follows FROM authenticated;
GRANT UPDATE (notify) ON public.user_follows TO authenticated;

NOTIFY pgrst, 'reload schema';
