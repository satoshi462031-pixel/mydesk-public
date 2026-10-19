-- =============================================================
-- Migration 085: フォロー中の人のデスク更新を iPhone の通知で届ける
--
-- アプリ内の「更新」（ベル）は開かないと気づけない。フォロー（084）した人が
-- デスクを公開・更新したときに、端末へプッシュ通知を送る。
--
-- 送るのは Edge Function（notify-followers）だけで、ここは宛先と送信記録を持つ。
-- =============================================================

-- ─── 宛先（Expo の push token）────────────────────────────────
-- token を主キーにする。1台の端末でアカウントを切り替えたとき、前のアカウントの行が
-- 残ると、ログアウトした人のフォロー先の通知がその端末に届き続ける。
-- 書き込みは下の RPC だけにする。直接の upsert だと、前のアカウントの行を
-- RLS 越しに書き換えられず、登録し直しが黙って失敗する。
CREATE TABLE IF NOT EXISTS public.push_tokens (
  token      TEXT PRIMARY KEY CHECK (char_length(token) BETWEEN 1 AND 200),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 通知の文面は受け取る人の言語で作る（送る側の言語ではない）
  lang       TEXT NOT NULL DEFAULT 'ja' CHECK (lang IN ('ja', 'en')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_push_token(p_token TEXT, p_lang TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  INSERT INTO public.push_tokens (token, user_id, lang, updated_at)
  VALUES (p_token, auth.uid(), CASE WHEN p_lang = 'en' THEN 'en' ELSE 'ja' END, now())
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id, lang = EXCLUDED.lang, updated_at = now();
END;
$$;

-- 自分の行だけ消せる。他人の token を知っていても、その人の通知は止められない
CREATE OR REPLACE FUNCTION public.unregister_push_token(p_token TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.push_tokens WHERE token = p_token AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.register_push_token(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_push_token(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(TEXT) TO authenticated;

-- ─── 送信記録 ────────────────────────────────────────────────
-- 同じ変更で二度送らない・短時間に何度も更新する人の通知で相手を埋めないための控え。
-- last_stamp は通知した時点の content_updated_at（新規公開なら created_at）。
-- サービスロール（Edge Function）だけが読み書きする
CREATE TABLE IF NOT EXISTS public.desk_push_log (
  desk_id      UUID PRIMARY KEY REFERENCES public.desks(id) ON DELETE CASCADE,
  last_stamp   TIMESTAMPTZ NOT NULL,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.desk_push_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.desk_push_log FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
