-- 公開ニックネームを変えても、既に公開したデスクの投稿者名が変わらなかった。
-- desks.owner_name は publishService が公開のたびにコピーする非正規化値で、
-- 端末の AsyncStorage にしか正が無く、追随する経路が存在しなかった。
-- 名前を消しても公開ページに残り続け、機種変更後は端末側が空になるため
-- 「更新して公開」で owner_name が空に上書きされて投稿者名が消えていた。
--
-- profiles は 046 で本人しか読めないため、閲覧側から join して名前を引くことは
-- できない。非正規化コピーは残したまま、サーバー側で追随させる。

-- ─── 1) 投稿者名だけの変更では更新時刻を進めない ────────────────
-- 050 は「desks への UPDATE はすべて内容の変更にあたる」として列を限定せずに
-- updated_at を進めている。名前の変更はその例外で、ここを通すと名前を変えた
-- だけでみんなのデスク（updated_at の降順）が自分のデスクで埋まる。
-- owner_name が動いたときだけ行全体を比べ、他に差が無ければ据え置く。
-- share_snapshot が大きいので、比較は owner_name が変わったときに限る。
-- この関数は desks 専用（OLD.owner_name を参照する）。他のテーブルには貼らない。
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_name IS DISTINCT FROM OLD.owner_name
     AND (to_jsonb(NEW) - 'owner_name' - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'owner_name' - 'updated_at')
  THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ─── 2) 公開名の変更を profiles と自分の公開デスクへ同時に反映する ──
-- クライアントから desks を直接 UPDATE させると、他人のデスクを弾くのは RLS 頼みに
-- なるうえ、名前の検証も端末側の実装次第になる。ここで一括して行う。
CREATE OR REPLACE FUNCTION public.set_public_owner_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  -- 端末側（設定画面）と同じ 20 文字。切り詰めはここでも行い、
  -- クライアントを迂回した呼び出しでも公開ページの表示が崩れないようにする。
  v_name := LEFT(BTRIM(COALESCE(p_name, '')), 20);

  -- 024 と同じ方針。公開される名前にメールアドレスを入れさせない。
  IF v_name ~* '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'public identity contains an email address' USING ERRCODE = '23514';
  END IF;

  -- 機種変更・再インストール後に端末側を埋め直せるよう、サーバーにも持たせる。
  UPDATE public.profiles
  SET display_name = NULLIF(v_name, '')
  WHERE id = v_uid;

  -- 公開済みのデスクを追随させる。1) の変更により、ここでは updated_at は動かない。
  UPDATE public.desks
  SET owner_name = v_name
  WHERE user_id = v_uid
    AND owner_name IS DISTINCT FROM v_name;

  RETURN v_name;
END;
$$;

REVOKE ALL ON FUNCTION public.set_public_owner_name(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_public_owner_name(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
