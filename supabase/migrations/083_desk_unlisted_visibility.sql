-- URL限定公開（083）。
--
-- desks.visibility に 'unlisted' を足す。リンク（デスクID）を知っている人だけが開けて、
-- みんなのデスク・検索・公開プロフィール・統計には載らない。
--
-- ■ RLS（desks_select_public / desk_photos_select / devices_select / connections_select）は
--   'public' のまま広げない。「unlisted も誰でも読める」にすると、REST で
--   visibility=eq.unlisted を指定するだけで URL限定のデスクを全件列挙できてしまい、
--   限定の意味が無くなる。ID を指定したときだけ中身を返す関数を別に置く（3・4）。
-- ■ 載せる側（search_public_desks・desk_stats・gadget_insight・公開プロフィール・
--   owner_tag_lower の部分索引）はすでに visibility = 'public' で絞っているので触らない。
-- ■ いいね・保存・欲しいもの（054 / 017 / 066）も 'public' のデスクだけのまま。
--   保存一覧と更新のベルは RLS 越しに desks を読むので、URL限定を保存できても一覧に出せない。
--
-- 'public' を見る条件を新しく書くときは、「開けるか」と「載せるか」のどちらを
-- 決めているのかを先に決めること。開ける側は 'unlisted' も通し、載せる側は通さない。

-- ─── 1) 値 ───────────────────────────────────────────────────
ALTER TABLE public.desks DROP CONSTRAINT IF EXISTS desks_visibility_check;
ALTER TABLE public.desks
  ADD CONSTRAINT desks_visibility_check CHECK (visibility IN ('public', 'unlisted', 'private'));

-- ─── 2) 公開文面の検査 ─────────────────────────────────────────
-- URL限定もリンクが出回れば誰でも読める。038 は 'public' 以外を素通りさせていたので、
-- 'private' だけを素通りさせる形に直す（検査の中身は 038 と同じ）
CREATE OR REPLACE FUNCTION public.validate_public_desk_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_identity TEXT := coalesce(NEW.title, '') || E'\n' || coalesce(NEW.owner_name, '');
  v_content  TEXT := lower(v_identity || E'\n' || coalesce(NEW.description, '') || E'\n' || coalesce(NEW.share_snapshot::text, ''));
BEGIN
  IF NEW.visibility = 'private' THEN
    RETURN NEW;
  END IF;

  IF v_identity ~* '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'public identity contains an email address' USING ERRCODE = '23514';
  END IF;

  IF v_content ~ '(児童ポルノ|児童性的|性的搾取|殺害予告|自殺方法|child[[:space:]]*(porn|sexual)|sexual[[:space:]]*exploitation|kill[[:space:]]+yourself)' THEN
    RAISE EXCEPTION 'public content is prohibited' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 3) リンクから開く（アプリの公開デスク画面）──────────────────
-- getDeskWithDetails の select('*, desk_photos(*), devices(*), connections(*)') と同じ形で返す。
-- 公開中のデスクは RLS でも読めるが、ここでも返す（呼び出し側が見え方で分岐しなくてよい）
CREATE OR REPLACE FUNCTION public.get_link_shared_desk(p_desk_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(d)
    || jsonb_build_object(
      'desk_photos', COALESCE(
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order) FROM public.desk_photos p WHERE p.desk_id = d.id),
        '[]'::jsonb
      ),
      'devices', COALESCE(
        (SELECT jsonb_agg(to_jsonb(v)) FROM public.devices v WHERE v.desk_id = d.id),
        '[]'::jsonb
      ),
      'connections', COALESCE(
        (SELECT jsonb_agg(to_jsonb(c)) FROM public.connections c WHERE c.desk_id = d.id),
        '[]'::jsonb
      )
    )
  FROM public.desks d
  WHERE d.id = p_desk_id
    AND d.visibility IN ('public', 'unlisted');
$$;

REVOKE ALL ON FUNCTION public.get_link_shared_desk(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_link_shared_desk(UUID) TO anon, authenticated;

-- ─── 4) リンクのプレビュー（worker の /d/:id）───────────────────
-- クローラーに返すのは名前・説明・1枚目の写真だけ。金額・機器名は載せない
CREATE OR REPLACE FUNCTION public.get_link_shared_desk_meta(p_desk_id UUID)
RETURNS TABLE (title TEXT, description TEXT, image_url TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.title,
    d.description,
    (SELECT p.image_url FROM public.desk_photos p WHERE p.desk_id = d.id ORDER BY p.sort_order LIMIT 1)
  FROM public.desks d
  WHERE d.id = p_desk_id
    AND d.visibility IN ('public', 'unlisted');
$$;

REVOKE ALL ON FUNCTION public.get_link_shared_desk_meta(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_link_shared_desk_meta(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
