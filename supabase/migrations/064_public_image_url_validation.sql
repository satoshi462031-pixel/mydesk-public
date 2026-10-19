-- =============================================================
-- Migration 064: 公開される画像URLの検証を、部分一致から先頭固定に直す
--
-- 059 の set_public_avatar_url は「本人が自分のフォルダへアップロードした画像だけ
-- 通す」つもりで次のように書いていた。
--
--   IF v_url NOT LIKE 'https://%' OR POSITION(v_prefix IN v_url) = 0 THEN
--
-- POSITION は文字列の**どこかに**含まれていれば 0 以外を返すので、ホストが固定
-- されていない。RPC を直接叩けば
--
--   https://evil.example/x/storage/v1/object/public/desk-images/<自分のuid>/avatar/a.jpg
--
-- が通り、そのアイコンが出る一覧を見た人**全員の端末**が第三者のサーバーへ画像を
-- 取りに行く（閲覧者の IP と UA が渡る）。相手は後から中身を差し替えられるので、
-- 一度確認した絵が別のものに変わる。059 のコメントが避けようとしていた事象そのもの。
--
-- publish_desk_snapshot（045）のデスク写真は、そもそも検証が無い。同じ穴が
-- より広い形で空いているので、ここで揃えて塞ぐ。
--
-- 既存データが弾かれないことは投入前に確認済み（desk_photos 9行すべて一致、
-- public_avatar_url / owner_avatar_url は 0 行）。
-- =============================================================

-- ─── 1) 検証の本体 ───────────────────────────────────────────────
-- ホストからファイル名までを1本の正規表現で先頭固定する。クエリ文字列と
-- フラグメントも文字集合で弾く（`...avatar/a.jpg?x=` で騙せる余地を残さない）。
--
-- **ホストは直書き。** 別プロジェクトへ移すときはここも変える。任意の Supabase
-- ホストを許すと意味が無い（攻撃者が自分のプロジェクトを立てれば同じパスを作れる）。
-- 公開バケットの URL なので、この値は既に公開デスクの写真URLに出ている。
CREATE OR REPLACE FUNCTION public.is_own_public_image_url(p_url TEXT, p_uid UUID, p_folder TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_url, '') ~ (
    '^https://zewoyfbbhchvbmrzlosj\.supabase\.co/storage/v1/object/public/desk-images/'
    || p_uid::TEXT || '/' || p_folder || '/[A-Za-z0-9._-]+$'
  );
$$;

COMMENT ON FUNCTION public.is_own_public_image_url(TEXT, UUID, TEXT) IS
  '公開バケットの、その利用者のフォルダに実在しうる形の URL か。呼び出し側が渡す p_folder は avatar かデスクIDのどちらか';

-- ─── 2) アイコン（059 の置き換え）──────────────────────────────
CREATE OR REPLACE FUNCTION public.set_public_avatar_url(p_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_url TEXT := NULLIF(BTRIM(COALESCE(p_url, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_url IS NOT NULL AND NOT public.is_own_public_image_url(v_url, v_uid, 'avatar') THEN
    RAISE EXCEPTION 'avatar must be an uploaded image owned by the caller' USING ERRCODE = '23514';
  END IF;

  UPDATE public.profiles
  SET public_avatar_url = v_url
  WHERE id = v_uid;

  UPDATE public.desks
  SET owner_avatar_url = v_url
  WHERE user_id = v_uid
    AND owner_avatar_url IS DISTINCT FROM v_url;

  RETURN v_url;
END;
$$;

REVOKE ALL ON FUNCTION public.set_public_avatar_url(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_public_avatar_url(TEXT) TO authenticated;

-- ─── 3) デスク写真（045 の置き換え）────────────────────────────
-- 変えたのは desk_photos への INSERT の直前に検証を1つ足したところだけ。
-- 写真は uploadDeskImage が `<user_id>/<desk_id>/` に置くので、フォルダは
-- p_desk_id で確定できる（他人のデスクのフォルダも指せない）。
CREATE OR REPLACE FUNCTION public.publish_desk_snapshot(
  p_desk_id UUID,
  p_devices JSONB,
  p_connections JSONB,
  p_image_urls JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  device JSONB;
  connection JSONB;
  image_url TEXT;
  new_device_id UUID;
  device_ids JSONB := '{}'::JSONB;
  sort_index INTEGER := 0;
  v_uid UUID := auth.uid();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.desks WHERE id = p_desk_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'desk not found or not owned by current user';
  END IF;

  DELETE FROM public.connections WHERE desk_id = p_desk_id;
  DELETE FROM public.devices WHERE desk_id = p_desk_id;

  FOR device IN SELECT value FROM jsonb_array_elements(COALESCE(p_devices, '[]'::JSONB)) LOOP
    INSERT INTO public.devices (desk_id, name, category, price, ports, purchased_at, removed_at)
    VALUES (
      p_desk_id,
      device->>'name',
      device->>'category',
      NULLIF(device->>'price', '')::INTEGER,
      COALESCE(device->'ports', '[]'::JSONB),
      NULLIF(device->>'purchased_at', '')::DATE,
      NULLIF(device->>'removed_at', '')::DATE
    )
    RETURNING id INTO new_device_id;
    device_ids := device_ids || jsonb_build_object(device->>'local_id', new_device_id);
  END LOOP;

  FOR connection IN SELECT value FROM jsonb_array_elements(COALESCE(p_connections, '[]'::JSONB)) LOOP
    IF device_ids ? (connection->>'from_local_id') AND device_ids ? (connection->>'to_local_id') THEN
      INSERT INTO public.connections (
        desk_id,
        from_device_id,
        to_device_id,
        cable_type,
        branch_group_id
      )
      VALUES (
        p_desk_id,
        (device_ids->>(connection->>'from_local_id'))::UUID,
        (device_ids->>(connection->>'to_local_id'))::UUID,
        connection->>'cable_type',
        LEFT(NULLIF(connection->>'branch_group_id', ''), 64)
      );
    END IF;
  END LOOP;

  DELETE FROM public.desk_photos WHERE desk_id = p_desk_id;
  FOR image_url IN SELECT value FROM jsonb_array_elements_text(COALESCE(p_image_urls, '[]'::JSONB)) LOOP
    IF NOT public.is_own_public_image_url(image_url, v_uid, p_desk_id::TEXT) THEN
      RAISE EXCEPTION 'desk photo must be an uploaded image owned by the caller' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.desk_photos (desk_id, image_url, sort_order)
    VALUES (p_desk_id, image_url, sort_index);
    sort_index := sort_index + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_desk_snapshot(UUID, JSONB, JSONB, JSONB)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
