-- =============================================================
-- Migration 061: 機材・写真の更新日時（desks）と、@ID を本人が決めたか（profiles）
--
-- もとは 061_desk_content_updated_at.sql と 061_public_tag_chosen.sql の2本に
-- 分かれていた。番号が重複していると supabase_migrations.schema_migrations の
-- 主キー（版＝先頭の数字）が衝突し、**1本目を適用した直後に2本目で落ちて
-- 本番が中途状態で止まる**（db push は順に当てる）。
--
-- 番号を振り直す手もあるが、061 と 062 の間に空きが無く、
--   ・content_updated_at は 065（search_public_desks の戻り列）より前
--   ・public_tag_chosen は 062（public_tag_required）より前
-- という制約があるため、後続を全部繰り上げないと動かせない。
-- 触る内容は desks の列と profiles の列で交差しないので、1本に束ねた。
-- =============================================================

-- ─── 1) desks: 機材・写真が更新されたことを閲覧側に見せる ─────────

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS content_signature  TEXT,
  ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.desks.content_signature  IS '公開している機材と写真の指紋（publicContentSignature）。比較にだけ使う';
COMMENT ON COLUMN public.desks.content_updated_at IS '機材か写真が最後に変わった日時。一度も変わっていなければ NULL';

-- 進めるのはサーバー側だけ。クライアントが直接書いた値は採用しない
-- （偽の更新日を立てられる／古い日付へ戻せる）。
CREATE OR REPLACE FUNCTION public.touch_desk_content_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- 前回の指紋を持っていない行では日時を入れない。061 以前に公開された
  -- デスクと初回公開がこれにあたる。ここで NOW() を入れると、中身は同じなのに
  -- 公開済みのデスクが次の公開で一斉に「機材更新」になる。
  -- 比較の基準ができるのはこの公開からで、実際の変更は次回から出せばよい
  IF OLD.content_signature IS NOT NULL
     AND NEW.content_signature IS NOT NULL
     AND NEW.content_signature IS DISTINCT FROM OLD.content_signature
  THEN
    NEW.content_updated_at = NOW();
  ELSE
    NEW.content_updated_at = OLD.content_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

-- update_updated_at（050/059/060）とは別のトリガにする。あちらは
-- 「所有者の表示名だけの変更では updated_at を進めない」判定を持っており、
-- 書き足すたびに条件が絡み合う。名前順で desks_content_updated_at が先に走るが、
-- 触る列が違うので互いに影響しない
DROP TRIGGER IF EXISTS desks_content_updated_at ON public.desks;
CREATE TRIGGER desks_content_updated_at
  BEFORE UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.touch_desk_content_updated_at();

-- 既存行の backfill はしない。updated_at をコピーすると、機材を一度も
-- 変えていないデスクに「機材更新」が付く（この列を作った意味が無くなる）。

NOTIFY pgrst, 'reload schema';

-- ─── 2) profiles: @ID を本人が決めたか ───────────────────────────

-- Migration 061: @ID をアカウント作成時に本人が決められるようにする
--
-- 060 で @ID は変えられるようになったが、決める場所は設定の奥（プロフィール編集）
-- だけで、登録した人には「自分に @A1B2C3 が振られている」ことすら見えない。
-- 名乗りは登録の直後に決めるのが自然なので、初回サインインの後に一度だけ聞く。
--
-- **「まだ自分で決めていない人」はランダム値からは判定できない。** 抽選値
-- （generate_public_tag の6桁16進）と本人が選んだ値は形が同じで、本人が
-- 'A1B2C3' を選ぶこともできる。聞いたかどうかを列で持つ。
--
-- 既存ユーザーは TRUE で埋める。彼らはこの画面を通っていないが、次の起動で
-- 全員に登録時の質問を出すのは「登録の続き」ではなく、ただの割り込みになる。
-- 変えたい人には設定（060）の入口がある。
-- =============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_tag_chosen BOOLEAN NOT NULL DEFAULT FALSE;

-- 既存の行だけを「聞き終わった」ことにする。handle_new_user はこの列を挿さないので、
-- ここから先に作られたアカウントは既定の FALSE で入る
UPDATE public.profiles SET public_tag_chosen = TRUE WHERE public_tag_chosen = FALSE;

-- ─── 決めたら二度と聞かない ─────────────────────────────────────
-- 060 の set_public_tag に、聞き終わった印を足しただけ。
CREATE OR REPLACE FUNCTION public.set_public_tag(p_tag TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_tag     TEXT := REGEXP_REPLACE(BTRIM(COALESCE(p_tag, '')), '^[#@]', '');
  v_current TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_tag !~ '^[A-Za-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'PUBLIC_TAG_INVALID' USING ERRCODE = '23514';
  END IF;

  SELECT public_tag INTO v_current FROM public.profiles WHERE id = v_uid;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_TAG_NO_PROFILE' USING ERRCODE = 'P0002';
  END IF;

  -- 自分が既に持っている綴りなら、予約語でも大文字小文字だけ直せる（公式の @MyDesk）
  IF LOWER(v_current) IS DISTINCT FROM LOWER(v_tag) THEN
    IF public.is_reserved_public_tag(v_tag) THEN
      RAISE EXCEPTION 'PUBLIC_TAG_RESERVED' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE LOWER(public_tag) = LOWER(v_tag) AND id <> v_uid
    ) THEN
      RAISE EXCEPTION 'PUBLIC_TAG_TAKEN' USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 抽選値をそのまま選ぶこともできる。値が同じでも「本人が決めた」ことは記録する
  IF v_current = v_tag THEN
    UPDATE public.profiles SET public_tag_chosen = TRUE
    WHERE id = v_uid AND public_tag_chosen IS DISTINCT FROM TRUE;
    RETURN v_tag;
  END IF;

  PERFORM set_config('app.public_tag_change', 'on', TRUE);
  UPDATE public.profiles
  SET public_tag = v_tag, public_tag_chosen = TRUE
  WHERE id = v_uid;
  PERFORM set_config('app.public_tag_change', '', TRUE);

  UPDATE public.desks
  SET owner_tag = v_tag
  WHERE user_id = v_uid
    AND owner_tag IS DISTINCT FROM v_tag;

  RETURN v_tag;
EXCEPTION WHEN unique_violation THEN
  -- 同じ @ID を同時に取りに来た場合。一意インデックスで負けた側をここで畳む
  RAISE EXCEPTION 'PUBLIC_TAG_TAKEN' USING ERRCODE = '23505';
END;
$$;

-- ─── 「あとで決める」──────────────────────────────────────────
-- 登録の一歩目を必須にすると、決められない人がそこで降りる。抽選値のまま進めて、
-- 設定からいつでも変えられる。端末ではなくアカウントに覚えさせる
-- （機種変更や再インストールのたびに登録時の質問が出るのはおかしい）。
CREATE OR REPLACE FUNCTION public.dismiss_public_tag_prompt()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET public_tag_chosen = TRUE WHERE id = v_uid;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_public_tag(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_public_tag(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.dismiss_public_tag_prompt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_public_tag_prompt() TO authenticated;

NOTIFY pgrst, 'reload schema';
