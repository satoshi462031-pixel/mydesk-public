-- =============================================================
-- Migration 069: 公開画像URLの検証を、RPC の中から列そのものへ移す
--
-- 064 は「本人がアップロードした画像だけ公開列に入る」ようにするため、
-- set_public_avatar_url と publish_desk_snapshot の2つの RPC に
-- is_own_public_image_url() の検査を足した。塞がったのはその2つの入口だけで、
-- PostgREST から直接叩ける経路が3つ残っていた。
--
--   1) POST  /desk_photos  … desk_photos_insert_own は所有者しか見ない
--   2) PATCH /desk_photos  … desk_photos_update_own（027）も所有者しか見ない
--   3) PATCH /profiles     … profiles_update_own（046）も列を絞っていない
--
-- 3) は間接経路。profiles.public_avatar_url に任意の URL を入れたあと自分の
-- デスクを1回 UPDATE すると、059 の set_desk_owner_tag が profiles の確定値を
-- desks.owner_avatar_url へコピーする。コピーされた値は search_public_desks の
-- 戻り列に載り、みんなのデスク・検索・公開プロフィールで AuthorAvatar が読む。
--
-- どれも成立すると、公開ページを開いた**閲覧者全員の端末**が第三者のサーバーへ
-- 画像を取りに行く（IP と UA が渡り、相手は後から中身を差し替えられる）。
-- 064 が防ごうとした事象そのもので、064 のコメントが desk_photos について
-- 「そもそも検証が無い」と書いていた穴が、INSERT 経路にだけ蓋をした形で残っていた。
--
-- **経路ごとにポリシーへ条件を足すのはやめる。** 経路は今後も増える（実際に
-- 027 は「公開取り消しのため」という理由で後から足された）。列に対する
-- トリガにすれば、書き込み経路が増えても素通りしない。
--
-- desks.owner_avatar_url にはトリガを足さない。あの列は 059 の
-- set_desk_owner_tag が BEFORE INSERT OR UPDATE OF owner_avatar_url で
-- profiles の値に上書きするので、直接書いた値はそもそも残らない。
-- profiles 側を締めれば同時に閉じる。
-- =============================================================

-- ─── 1) デスク写真 ───────────────────────────────────────────────
-- 所有者は auth.uid() ではなくデスクの user_id から引く。写真は
-- uploadDeskImage が `<user_id>/<desk_id>/` に置くので、フォルダの正解は
-- 書き込んだ人ではなくデスクの持ち主で決まる（SECURITY DEFINER の
-- publish_desk_snapshot 経由でも同じ判定になる）。
CREATE OR REPLACE FUNCTION public.validate_desk_photo_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  IF NEW.image_url IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_owner FROM public.desks WHERE id = NEW.desk_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'desk not found for photo' USING ERRCODE = '23503';
  END IF;

  IF NOT public.is_own_public_image_url(NEW.image_url, v_owner, NEW.desk_id::TEXT) THEN
    RAISE EXCEPTION 'desk photo must be an uploaded image owned by the desk owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desk_photos_validate_image_url ON public.desk_photos;
CREATE TRIGGER desk_photos_validate_image_url
  BEFORE INSERT OR UPDATE OF image_url ON public.desk_photos
  FOR EACH ROW EXECUTE FUNCTION public.validate_desk_photo_url();

-- ─── 2) 公開アイコン ─────────────────────────────────────────────
-- NULL は「未設定」で、アイコンを外す正当な操作。文字アイコンに戻る（059）。
CREATE OR REPLACE FUNCTION public.validate_public_avatar_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_avatar_url IS NOT NULL
     AND NOT public.is_own_public_image_url(NEW.public_avatar_url, NEW.id, 'avatar')
  THEN
    RAISE EXCEPTION 'avatar must be an uploaded image owned by the caller'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- protect_profile_tier（014・019）とは別のトリガにする。触る列が違うので
-- 実行順は結果に影響しない。1つの関数に混ぜると、条件が絡んで読めなくなる
DROP TRIGGER IF EXISTS profiles_validate_public_avatar_url ON public.profiles;
CREATE TRIGGER profiles_validate_public_avatar_url
  BEFORE INSERT OR UPDATE OF public_avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_avatar_url();

-- ─── 3) 既存行を弾かないことの確認手順 ─────────────────────────────
-- トリガは書き込む行だけを見るので既存行はそのままだが、次に書き換えた
-- ときに落ちると公開の取り消し（revokePublishedPhotoUrls）が止まる。
-- 投入前に 0 行であることを確認する：
--
--   SELECT p.id, p.image_url
--   FROM public.desk_photos p JOIN public.desks d ON d.id = p.desk_id
--   WHERE NOT public.is_own_public_image_url(p.image_url, d.user_id, p.desk_id::TEXT);
--
--   SELECT id, public_avatar_url FROM public.profiles
--   WHERE public_avatar_url IS NOT NULL
--     AND NOT public.is_own_public_image_url(public_avatar_url, id, 'avatar');
--
-- rotateDeskImage が作る名前は `<ミリ秒>-<32桁hex>.jpg` で、064 の
-- 正規表現 `[A-Za-z0-9._-]+$` に収まる（失効処理は通る）。

NOTIFY pgrst, 'reload schema';
