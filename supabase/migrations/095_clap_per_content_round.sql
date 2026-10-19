-- =============================================================
-- Migration 095: いいねを「拍手」にし、デスクの更新（版）ごとに送り直せるようにする
--
-- いいねは1人1デスク1回で、一度押した人は二度と反応を送れなかった。デスクは
-- 機材を入れ替えながら育つものなので、変わるたびに同じ人から反応が届くほうが、
-- 更新 → 保存した人に届く → 拍手 → 投稿者に届く → また更新、の循環が少人数でも回る。
-- 仕様は docs/like-feature-spec.md。
--
-- ■ 版（desks.clap_round_at）
--   content_updated_at（061・機材か写真が変わった公開）が進んだら新しい版にする。
--   ただし今の版の開始から24時間未満の更新は同じ版にまとめる。短い間隔で何度も
--   更新されると、閲覧者のボタンが何度も「未拍手」へ戻るため。
--   進めるのはトリガだけ。クライアントが書いた値は採用しない（持ち主が版を勝手に
--   切り替えると、同じ人から何度でも拍手を集められる）。
--
-- ■ 拍手（likes.round_at）
--   どの版へ送ったかを持ち、一意制約を (desk_id, user_id, round_at) にする。
--   round_at は追加時のトリガが今の版で埋め、クライアントの値は採用しない。
--   取り消せるのは今の版の拍手だけ（過去の版は画面に出ないので、外す手段も要らない）。
--
-- ■ 件数（desks.like_count）
--   likes の行数のまま＝延べになる。版が変わってもリセットしない。
--   表の件数が減るなら更新を控える、という逆向きの動機を作らないため。
--
-- 内部名（likes / like_count / like_toggled）は変えない。導入前後の計測を1本の系列で
-- つなぐため（コード上の plan がデスクの旧称であるのと同じ扱い）。
-- =============================================================

-- ─── 1) desks.clap_round_at ─────────────────────────────────

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS clap_round_at TIMESTAMPTZ;

COMMENT ON COLUMN public.desks.clap_round_at IS
  '拍手を受け付ける今の版の開始日時。advance_desk_clap_round トリガだけが進める';

-- 既存行は今の中身を1つ目の版にする。トリガを止めて埋めるのは、この UPDATE を
-- desks_updated_at が「更新」と見て全デスクをフィードの先頭へ押し上げ、
-- desks_publish_log が全デスクの「公開」として記録するのを防ぐため
ALTER TABLE public.desks DISABLE TRIGGER USER;
UPDATE public.desks
SET clap_round_at = COALESCE(content_updated_at, created_at)
WHERE clap_round_at IS NULL;
ALTER TABLE public.desks ENABLE TRIGGER USER;

ALTER TABLE public.desks
  ALTER COLUMN clap_round_at SET DEFAULT now(),
  ALTER COLUMN clap_round_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.advance_desk_clap_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.clap_round_at := now();
  ELSIF NEW.content_updated_at IS NOT NULL
    AND NEW.content_updated_at IS DISTINCT FROM OLD.content_updated_at
    AND NEW.content_updated_at >= OLD.clap_round_at + INTERVAL '24 hours'
  THEN
    NEW.clap_round_at := NEW.content_updated_at;
  ELSE
    NEW.clap_round_at := OLD.clap_round_at;
  END IF;
  RETURN NEW;
END;
$$;

-- content_updated_at を決める desks_content_updated_at（061）の後に走らせる必要がある。
-- 同じ時点の BEFORE トリガは名前順に走るので、その名前を頭に含めて必ず後ろに並べる
DROP TRIGGER IF EXISTS desks_content_updated_at_clap_round ON public.desks;
CREATE TRIGGER desks_content_updated_at_clap_round
  BEFORE INSERT OR UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.advance_desk_clap_round();

-- desks_updated_at（081）の除外列には足さない。clap_round_at が動くのは
-- content_updated_at が動いたときだけで、そのときは updated_at も進むべき場面

-- ─── 2) likes.round_at ──────────────────────────────────────

ALTER TABLE public.likes
  ADD COLUMN IF NOT EXISTS round_at TIMESTAMPTZ;

-- 既存のいいねは今の版への拍手にする。過去の版へ回すと、移行した直後に
-- 全員のボタンが「未拍手」へ戻る
UPDATE public.likes l
SET round_at = d.clap_round_at
FROM public.desks d
WHERE d.id = l.desk_id
  AND l.round_at IS NULL;

ALTER TABLE public.likes
  ALTER COLUMN round_at SET NOT NULL;

ALTER TABLE public.likes
  DROP CONSTRAINT IF EXISTS likes_desk_id_user_id_key;
ALTER TABLE public.likes
  ADD CONSTRAINT likes_desk_id_user_id_round_at_key UNIQUE (desk_id, user_id, round_at);

COMMENT ON COLUMN public.likes.round_at IS
  '拍手した版（desks.clap_round_at）。set_like_round トリガが埋める';

-- 定義者権限にしない。拍手できるのは公開デスクだけで、公開デスクは本人の権限で読める。
-- 読めないデスク（非公開・URL限定）では NULL になり、NOT NULL で追加そのものが止まる
CREATE OR REPLACE FUNCTION public.set_like_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.round_at := (SELECT d.clap_round_at FROM public.desks d WHERE d.id = NEW.desk_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS likes_set_round ON public.likes;
CREATE TRIGGER likes_set_round
  BEFORE INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.set_like_round();

-- 取り消せるのは本人の、今の版の拍手だけ
DROP POLICY IF EXISTS "likes_delete_own" ON public.likes;
CREATE POLICY "likes_delete_own" ON public.likes
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    AND round_at = (SELECT d.clap_round_at FROM public.desks d WHERE d.id = likes.desk_id)
  );

CREATE INDEX IF NOT EXISTS idx_likes_desk_round ON public.likes (desk_id, round_at);

-- ─── 3) 持ち主への反応（086）に「今の版への拍手」を足す ────────
-- 戻り列が変わるので作り直す（CREATE OR REPLACE では列を足せない）

DROP FUNCTION IF EXISTS public.get_my_desk_reactions(TIMESTAMPTZ);

CREATE FUNCTION public.get_my_desk_reactions(p_since TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
  desk_id          UUID,
  title            TEXT,
  like_count       INTEGER,
  bookmark_count   INTEGER,
  new_like_count   INTEGER,
  checked_at       TIMESTAMPTZ,
  round_like_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id,
    d.title,
    d.like_count,
    (SELECT COUNT(*)::INTEGER FROM public.bookmarks b
      WHERE b.desk_id = d.id AND b.user_id <> d.user_id),
    CASE WHEN p_since IS NULL THEN 0 ELSE
      (SELECT COUNT(*)::INTEGER FROM public.likes l
        WHERE l.desk_id = d.id AND l.user_id <> d.user_id AND l.created_at > p_since)
    END,
    now(),
    (SELECT COUNT(*)::INTEGER FROM public.likes l
      WHERE l.desk_id = d.id AND l.user_id <> d.user_id AND l.round_at = d.clap_round_at)
  FROM public.desks d
  WHERE d.user_id = auth.uid()
    AND d.visibility IN ('public', 'unlisted');
$$;

REVOKE ALL ON FUNCTION public.get_my_desk_reactions(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_desk_reactions(TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
