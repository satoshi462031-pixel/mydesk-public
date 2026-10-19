-- =============================================================
-- Migration 057: 公開プロフィール（/u/<tag>）を見せるかを本人が選べるようにする
--
-- デスクの公開は 1 件ずつの明示操作なので、これまで「公開した覚えのないもの」は
-- 出ていなかった。049 で入れた公開プロフィールは、そこで公開済みのデスクを
-- 人単位でまとめて並べる。1 件を見つけた人が所有者の全デスク・総額・写真へ
-- 一覧で辿れるようになるのは、デスクを 1 件公開したときの同意を超えている。
-- しかもこの集約はデスクを公開したあとから足されたもので、既存の公開者は
-- 一度も選んでいない。まとめて見せるかどうかを本人が切れるようにする。
--
-- 既定は TRUE。個々のデスクは元から公開されており、フィードにも共有リンクにも
-- 出ている。ここを FALSE 既定にすると、集約を止めるのではなく機能を殺すだけになる。
--
-- OFF にしても止まるのは集約ページだけで、デスク 1 件ごとの公開・共有リンク・
-- みんなのデスクへの掲載は変わらない。「デスクを非公開にする」設定ではない。
--
-- profiles は 046 で本人しか読めないため、閲覧側から join できない。
-- owner_name（051）・owner_tag（049）と同じく desks へ非正規化してコピーし、
-- サーバー側のトリガと RPC で追随させる。
-- =============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_discoverable BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS owner_profile_public BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── 1) 設定の切り替えでみんなのデスクの並びを動かさない ────────────
-- 051 が owner_name について作った例外と同じ問題。owner_profile_public だけが
-- 動いたときに updated_at を進めると、トグルを 1 回押しただけで自分のデスクが
-- updated_at 降順のフィード先頭を埋める。比較対象に列を 1 つ足す。
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.owner_name IS DISTINCT FROM OLD.owner_name
      OR NEW.owner_profile_public IS DISTINCT FROM OLD.owner_profile_public)
     AND (to_jsonb(NEW) - 'owner_name' - 'owner_profile_public' - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'owner_name' - 'owner_profile_public' - 'updated_at')
  THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── 2) 新しいデスクにも本人の設定をコピーする ──────────────────
-- 049 の set_desk_owner_tag と同じ役目。クライアントが値を偽装しても、
-- 所有者の profiles にある確定値で上書きする。
CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT public_tag, profile_discoverable
    INTO NEW.owner_tag, NEW.owner_profile_public
  FROM public.profiles
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desks_set_owner_tag ON public.desks;
CREATE TRIGGER desks_set_owner_tag
  BEFORE INSERT OR UPDATE OF user_id, owner_tag, owner_profile_public ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.set_desk_owner_tag();

-- ─── 3) 既存デスクの補完（並び順を動かさない）────────────────────
-- 049 と同じ手順で updated_at のトリガを外して埋める。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.desks'::regclass
      AND tgname = 'desks_updated_at'
  ) THEN
    ALTER TABLE public.desks DISABLE TRIGGER desks_updated_at;
  END IF;
END;
$$;

UPDATE public.desks AS d
SET owner_profile_public = p.profile_discoverable
FROM public.profiles AS p
WHERE d.user_id = p.id
  AND d.owner_profile_public IS DISTINCT FROM p.profile_discoverable;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.desks'::regclass
      AND tgname = 'desks_updated_at'
  ) THEN
    ALTER TABLE public.desks ENABLE TRIGGER desks_updated_at;
  END IF;
END;
$$;

-- ─── 4) 設定の切り替え（profiles と自分のデスクを同時に更新）──────────
-- 051 の set_public_owner_name と同じ理由でサーバー側に寄せる。
-- クライアントから desks を直接 UPDATE させると、他人の行を弾くのが RLS 頼みになる。
CREATE OR REPLACE FUNCTION public.set_profile_discoverable(p_value BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_value BOOLEAN := COALESCE(p_value, TRUE);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET profile_discoverable = v_value
  WHERE id = v_uid;

  -- 2) のトリガは user_id / owner_tag / owner_profile_public の UPDATE でしか
  -- 走らないが、走ったところで profiles から同じ値を引き直すだけなので競合しない。
  UPDATE public.desks
  SET owner_profile_public = v_value
  WHERE user_id = v_uid
    AND owner_profile_public IS DISTINCT FROM v_value;

  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_profile_discoverable(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_profile_discoverable(BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
