-- 購読を別のアカウントへ移したとき（RevenueCat の TRANSFER）、その週の AI の利用回数を移し先へ持ち越す。
--
-- AI の回数・写真の回数・トークン予算は利用者×週（ai_usage）で数えている。購入の復元で購読が
-- 別のアカウントへ移ると、移し先は今週まだ1回も使っていない行から始まるので、1つの購読を
-- アカウントの間で行き来させるだけで、週の枠をアカウントの数だけ使えた
-- （A で30回使い切る → B で購入を復元 → B でまた30回 → 翌週は A へ戻す…）。
-- 枠をアカウントではなく購読につけるため、移し替えのたびに、元のアカウントの今週の消費を移し先に足す。
--
-- 大きい方を取るのではなく足す。Webhook が届く前に移し先で使った分（アプリの取り直しで先に
-- Pro になる）も数えに残すため。行き来すると上限を超えた数になりうるが、消費の判定は
-- 「上限以上なら止める」で、アプリも残り回数を 0 で止めて表示するので害は無い。
-- 元のアカウントの数は減らさない（元へ戻したときに枠が戻ると、行き来がまた得になる）。
--
-- RevenueCat は 2xx が返るまで同じイベントを再送する。同じ移し替えを二度足さないよう、
-- イベント・元・先の組で一度だけ適用する。

CREATE TABLE IF NOT EXISTS public.ai_usage_transfers (
  event_id    TEXT NOT NULL,
  from_user   UUID NOT NULL,
  to_user     UUID NOT NULL,
  period      TEXT NOT NULL,
  msg_count   INTEGER NOT NULL,
  photo_count INTEGER NOT NULL,
  token_count BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, from_user, to_user)
);

ALTER TABLE public.ai_usage_transfers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ai_usage_transfers TO service_role;

CREATE OR REPLACE FUNCTION public.carry_ai_usage_on_transfer(p_event_id TEXT, p_from UUID, p_to UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period TEXT := to_char(now(), 'IYYY-"W"IW');
  v_from   public.ai_usage%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR p_event_id = '' THEN
    RAISE EXCEPTION 'event id required';
  END IF;
  IF p_from = p_to THEN
    RETURN 'same_user';
  END IF;

  -- 移している最中に元か先で AI を使っていても数えがずれないよう、両方の今週の行を押さえる。
  -- 消費（consume_ai_usage）は1行ずつしか押さえないので、利用者 ID の順に押さえれば行き違わない
  INSERT INTO public.ai_usage (user_id, period)
  VALUES (p_from, v_period), (p_to, v_period)
  ON CONFLICT (user_id, period) DO NOTHING;
  PERFORM 1 FROM public.ai_usage
  WHERE period = v_period AND user_id IN (p_from, p_to)
  ORDER BY user_id
  FOR UPDATE;

  SELECT * INTO v_from FROM public.ai_usage WHERE user_id = p_from AND period = v_period;

  INSERT INTO public.ai_usage_transfers (event_id, from_user, to_user, period, msg_count, photo_count, token_count)
  VALUES (p_event_id, p_from, p_to, v_period, v_from.msg_count, v_from.photo_count, v_from.token_count)
  ON CONFLICT (event_id, from_user, to_user) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  UPDATE public.ai_usage AS t
  SET msg_count   = t.msg_count + v_from.msg_count,
      photo_count = t.photo_count + v_from.photo_count,
      token_count = t.token_count + v_from.token_count,
      updated_at  = now()
  WHERE t.user_id = p_to AND t.period = v_period;

  RETURN 'carried';
END;
$$;

-- 呼べるのは revenuecat-webhook（service_role）だけ。利用者が呼べると、他人の枠を減らせる
REVOKE ALL ON FUNCTION public.carry_ai_usage_on_transfer(TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carry_ai_usage_on_transfer(TEXT, UUID, UUID) TO service_role;
