-- =============================================================
-- Migration 008: AI利用回数のサーバーサイド管理
--
-- 従来 AI チャット/写真送信の月間利用回数は端末ローカルの AsyncStorage
-- のみで管理していたため、ログアウト → 同じメールで再ログイン（＝別端末
-- や再インストール後の初回起動でも AsyncStorage は空）すると回数が
-- リセットされてしまっていた。ここでは利用回数の正本を Supabase 側に
-- 移し、ユーザーアカウント（auth.users.id）に紐づけて記録する。
--
-- ai_usage テーブル自体へは authenticated ロールから直接 SELECT/INSERT/
-- UPDATE させない（RLS ポリシーを一切定義しない＝デフォルト拒否）。
-- 参照は get_ai_usage()、消費（インクリメント）は consume_ai_usage() の
-- 2つの SECURITY DEFINER 関数だけを窓口にすることで、クライアントが
-- 回数を直接書き換えたり他人の分を消費させたりできないようにする。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,   -- 'YYYY-MM'（月次リセット）
  msg_count   INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS ai_usage_user_period_idx ON public.ai_usage(user_id, period);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- ポリシーを一つも作らない＝authenticated/anon からは行に一切アクセス不可。
-- 読み書きは下記 SECURITY DEFINER 関数（呼び出し元の権限に関わらず定義者=テーブル所有者の
-- 権限で実行される）経由のみに限定する。

-- ─── 現在の利用状況を取得（クライアントから直接呼べる） ──────────
CREATE OR REPLACE FUNCTION public.get_ai_usage()
RETURNS TABLE(msg_count INTEGER, photo_count INTEGER, msg_limit INTEGER, photo_limit INTEGER, is_pro BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT := to_char(now(), 'YYYY-MM');
  v_tier   TEXT;
  v_row    public.ai_usage%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT tier INTO v_tier FROM public.profiles WHERE id = auth.uid();
  SELECT * INTO v_row FROM public.ai_usage WHERE user_id = auth.uid() AND period = v_period;

  RETURN QUERY SELECT
    COALESCE(v_row.msg_count, 0),
    COALESCE(v_row.photo_count, 0),
    CASE WHEN v_tier = 'pro' THEN 999999 ELSE 5 END,
    CASE WHEN v_tier = 'pro' THEN 20 ELSE 3 END,
    v_tier = 'pro';
END;
$$;

-- ─── 利用回数を1件消費する（Edge Function から service_role で呼ぶ想定） ──
-- p_user_id を明示的に受け取る：Edge Function は service_role キーで実行される
-- ため auth.uid() は NULL になる。呼び出し元で検証済みのユーザーIDを渡す。
CREATE OR REPLACE FUNCTION public.consume_ai_usage(p_user_id UUID, p_kind TEXT)
RETURNS TABLE(allowed BOOLEAN, msg_count INTEGER, photo_count INTEGER, msg_limit INTEGER, photo_limit INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period      TEXT := to_char(now(), 'YYYY-MM');
  v_tier        TEXT;
  v_msg_limit   INTEGER;
  v_photo_limit INTEGER;
  v_row         public.ai_usage%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('msg', 'photo') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  SELECT tier INTO v_tier FROM public.profiles WHERE id = p_user_id;
  v_msg_limit   := CASE WHEN v_tier = 'pro' THEN 999999 ELSE 5 END;
  v_photo_limit := CASE WHEN v_tier = 'pro' THEN 20 ELSE 3 END;

  INSERT INTO public.ai_usage (user_id, period)
  VALUES (p_user_id, v_period)
  ON CONFLICT (user_id, period) DO NOTHING;

  -- 同時リクエストでも正確にカウントするため行ロック
  SELECT * INTO v_row FROM public.ai_usage
    WHERE user_id = p_user_id AND period = v_period
    FOR UPDATE;

  IF p_kind = 'msg' THEN
    IF v_row.msg_count >= v_msg_limit THEN
      RETURN QUERY SELECT false, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
      RETURN;
    END IF;
    UPDATE public.ai_usage SET msg_count = msg_count + 1, updated_at = now()
      WHERE user_id = p_user_id AND period = v_period
      RETURNING * INTO v_row;
  ELSE
    IF v_row.photo_count >= v_photo_limit THEN
      RETURN QUERY SELECT false, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
      RETURN;
    END IF;
    UPDATE public.ai_usage SET photo_count = photo_count + 1, updated_at = now()
      WHERE user_id = p_user_id AND period = v_period
      RETURNING * INTO v_row;
  END IF;

  RETURN QUERY SELECT true, v_row.msg_count, v_row.photo_count, v_msg_limit, v_photo_limit;
END;
$$;

-- get_ai_usage は auth.uid() ベースなので authenticated から呼べる。
-- consume_ai_usage は p_user_id を任意に渡せてしまうため authenticated からは呼ばせず、
-- Edge Function（service_role）専用にする。
REVOKE ALL ON FUNCTION public.get_ai_usage()                 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_ai_usage()              TO authenticated;

REVOKE ALL ON FUNCTION public.consume_ai_usage(UUID, TEXT)    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_ai_usage(UUID, TEXT) TO service_role;
