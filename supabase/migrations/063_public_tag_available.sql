-- =============================================================
-- Migration 063: @ID が空いているかを入力中に確かめられるようにする
--
-- 060 の set_public_tag は保存の瞬間にしか答えを返さない。登録時（061）は
-- 名乗りを決めないと先へ進めないので、埋まっているかが押すまで分からないと
-- そこで何度も往復することになる。
--
-- 空き状況そのものは秘密ではない（@ID は /u/<tag> の URL に出る公開の値で、
-- 開けば埋まっているかは分かる）。ただし profiles は本人しか読めない（046）ので、
-- 判定だけを返す関数に閉じる。**行は一切返さない** — 誰が持っているかは答えない。
-- =============================================================

CREATE OR REPLACE FUNCTION public.public_tag_available(p_tag TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tag TEXT := REGEXP_REPLACE(BTRIM(COALESCE(p_tag, '')), '^[#@]', '');
BEGIN
  IF v_tag !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RETURN FALSE;
  END IF;
  IF public.is_reserved_public_tag(v_tag) THEN
    RETURN FALSE;
  END IF;
  -- 自分がいま持っている綴りは「空き」として返す。設定画面で大文字小文字だけを
  -- 直したい人に、自分の @ID が埋まっていると出さない
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE LOWER(public_tag) = LOWER(v_tag)
      AND id IS DISTINCT FROM auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.public_tag_available(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_tag_available(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
