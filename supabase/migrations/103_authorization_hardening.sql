-- =============================================================
-- Migration 103: 公開デスク・通報・@ID まわりの認可の穴を塞ぐ（2026-10-11 の監査）
--
-- 1) 新しいデスクを作るとき、サーバーが決める列をクライアントに選ばせない
--    like_count・updated_at などを守るトリガは BEFORE UPDATE にしか無く、INSERT は
--    user_id しか見ていなかった。updated_at を未来にした公開デスクを作れば
--    みんなのデスク（updated_at 降順）の先頭に居座り、拍手数も好きな値で出せた。
-- 2) 一度使われたデスク ID を他人が取り直せないようにする
--    デスク ID はクライアントが決めて INSERT できる。削除されたデスクの ID で作り直すと、
--    出回っている共有リンク（/@本人の@ID/<ID>。@ID の部分は照合しない）がそのデスクを開く。
--    097 の deleted_desk_links はアカウント削除で消えるので、ID だけを別に残す。
-- 3) 運営の非公開化・利用停止を本人が戻せないようにする
--    desks_update_own は visibility も含めて書けるので、service_role で非公開にしても
--    本人のアプリが公開に戻せた。消してもアプリが新しい ID で作り直す。
-- 4) 通報を、デスクの削除で消えない記録にする
--    desk_reports はデスクの削除に連鎖して消え、違反したデスクを消して出し直せば
--    通報ごと無かったことにできた。処理状況を持つ列も無かった。
-- 5) プロフィール非公開の人の @ID をデスクに写さない
--    057 は集約ページを止めたが、desks.owner_tag_lower で REST から同じ集約ができた。
-- 6) desks.owner_tier（082）をやめる
--    046 / 039 が「tier=eq.pro で課金者を抜き出せる」として閉じた情報を、公開デスクの列として
--    戻していた。歴史の範囲は、他人のデスクでは全期間・自分のデスクでは自分の契約で決める（アプリ側）。
-- 7) 手放された @ID を1年は他人に渡さない
--    @ID の変更・アカウント削除の直後に他人が同じ @ID を取ると、古い共有リンクと
--    プロフィールリンクで成りすませた。
-- =============================================================

-- ─── 2) 使われたデスク ID ───────────────────────────────────────
-- ID しか持たない。アカウント削除でも消さない（消すとその人の古いリンクを取り直せる）。
CREATE TABLE public.retired_desk_ids (
  desk_id    UUID PRIMARY KEY,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.retired_desk_ids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retired_desk_ids FROM PUBLIC, anon, authenticated;

INSERT INTO public.retired_desk_ids (desk_id)
SELECT desk_id FROM public.deleted_desk_links
ON CONFLICT (desk_id) DO NOTHING;

CREATE FUNCTION public.retire_desk_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.retired_desk_ids (desk_id) VALUES (OLD.id)
  ON CONFLICT (desk_id) DO NOTHING;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.retire_desk_id() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER desks_retire_id
  BEFORE DELETE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.retire_desk_id();

-- ─── 1) + 2) サーバーが決める列を固定する ──────────────────────
-- アプリの createDesk はここで上書きする列を送っていないので、正規の公開は変わらない。
-- 更新時の like_count / updated_at / content_updated_at は 054 / 082 / 061 が守っており、
-- 作成日時（初回公開の日時）だけ更新で書き換えられたのでここで止める
CREATE FUNCTION public.pin_server_desk_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.retired_desk_ids WHERE desk_id = NEW.id) THEN
    RAISE EXCEPTION 'DESK_ID_RETIRED' USING ERRCODE = '23505';
  END IF;
  NEW.like_count := 0;
  NEW.created_at := now();
  NEW.updated_at := now();
  NEW.content_updated_at := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pin_server_desk_columns() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER desks_pin_server_columns
  BEFORE INSERT OR UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.pin_server_desk_columns();

-- ─── 3) 運営の非公開化と利用停止 ──────────────────────────────
-- どちらも本人からは書けない（090 の is_official と同じく、フラグを立てた
-- トランザクションの中でしか変わらない）。立てられるのは下の admin_* 関数だけ。
ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS moderation_hidden_at TIMESTAMPTZ;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS publishing_suspended_at TIMESTAMPTZ;

COMMENT ON COLUMN public.desks.moderation_hidden_at IS
  '運営が非公開にした日時（103）。立っている間は公開・URL限定にできない。本人は書けない';
COMMENT ON COLUMN public.profiles.publishing_suspended_at IS
  '運営が公開を止めた日時（103）。立っている間はこの人のデスクを公開・URL限定にできない。本人は書けない';

CREATE FUNCTION public.guard_desk_moderation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.moderation_action', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.moderation_hidden_at := NULL;
    ELSE
      NEW.moderation_hidden_at := OLD.moderation_hidden_at;
    END IF;
  END IF;

  IF NEW.visibility <> 'private' THEN
    IF NEW.moderation_hidden_at IS NOT NULL THEN
      RAISE EXCEPTION 'DESK_MODERATION_HIDDEN' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = NEW.user_id AND publishing_suspended_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'PUBLISHING_SUSPENDED' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_desk_moderation() FROM PUBLIC, anon, authenticated;

-- 名前順で desks_queue_photo_revocation（100）より先に走らせ、止めた理由を先に返す
CREATE TRIGGER desks_moderation_guard
  BEFORE INSERT OR UPDATE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.guard_desk_moderation();

CREATE FUNCTION public.protect_profile_publishing_suspension()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.moderation_action', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.publishing_suspended_at := NULL;
    ELSE
      NEW.publishing_suspended_at := OLD.publishing_suspended_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_publishing_suspension() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_protect_publishing_suspension
  BEFORE INSERT OR UPDATE OF publishing_suspended_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_publishing_suspension();

-- 運営の入口（scripts/moderation.ts から service_role で呼ぶ）。
-- 非公開にすると 100 のトリガが写真の失効を本人のアプリへ回すが、本人が開くまで
-- 写真の URL は生きている。すぐ止めるときはスクリプトが写真の実体も消す。
CREATE FUNCTION public.admin_set_desk_hidden(p_desk_id UUID, p_hidden BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.moderation_action', 'on', true);
  UPDATE public.desks
  SET moderation_hidden_at = CASE WHEN p_hidden THEN COALESCE(moderation_hidden_at, now()) END,
      visibility = CASE WHEN p_hidden THEN 'private' ELSE visibility END
  WHERE id = p_desk_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'desk not found: %', p_desk_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('app.moderation_action', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_desk_hidden(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_desk_hidden(UUID, BOOLEAN) TO service_role;

CREATE FUNCTION public.admin_set_publishing_suspended(p_user_id UUID, p_suspended BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed INTEGER := 0;
BEGIN
  PERFORM set_config('app.moderation_action', 'on', true);
  UPDATE public.profiles
  SET publishing_suspended_at = CASE WHEN p_suspended THEN COALESCE(publishing_suspended_at, now()) END
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found: %', p_user_id USING ERRCODE = 'P0002';
  END IF;
  -- 止めている間に公開のまま残るデスクを作らない。解除しても自動では戻さない（本人が公開し直す）
  IF p_suspended THEN
    UPDATE public.desks SET visibility = 'private'
    WHERE user_id = p_user_id AND visibility <> 'private';
    GET DIAGNOSTICS v_closed = ROW_COUNT;
  END IF;
  PERFORM set_config('app.moderation_action', '', true);
  RETURN v_closed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_publishing_suspended(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_publishing_suspended(UUID, BOOLEAN) TO service_role;

-- ─── 4) 通報を残る記録にする ──────────────────────────────────
-- デスクへの外部キーを外し、ID・持ち主・題名を控える。通報者がアカウントを消した
-- 通報は、通報者だけ外して残す（プライバシーポリシー 11-7 の「通報の記録」）。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.desk_reports'::regclass
      AND c.contype = 'f'
      AND a.attname IN ('desk_id', 'reporter_id')
  LOOP
    EXECUTE format('ALTER TABLE public.desk_reports DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.desk_reports
  ALTER COLUMN reporter_id DROP NOT NULL,
  ADD CONSTRAINT desk_reports_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS desk_owner_id   UUID,
  ADD COLUMN IF NOT EXISTS desk_title      TEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

ALTER TABLE public.desk_reports
  ADD CONSTRAINT desk_reports_status_check
    CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  ADD CONSTRAINT desk_reports_note_size
    CHECK (note IS NULL OR char_length(note) <= 1000) NOT VALID;

-- 既存の通報にも控えを入れる（まだデスクが残っているものだけ）
UPDATE public.desk_reports r
SET desk_owner_id = d.user_id, desk_title = d.title
FROM public.desks d
WHERE d.id = r.desk_id AND r.desk_owner_id IS NULL;

CREATE INDEX IF NOT EXISTS desk_reports_status_created_idx
  ON public.desk_reports (status, created_at);
CREATE INDEX IF NOT EXISTS desk_reports_owner_idx
  ON public.desk_reports (desk_owner_id);

-- 通報できるのは開けるデスク（公開・URL限定）だけ。任意の UUID で非公開デスクの
-- 有無を確かめる口にしない。状態の列は通報者に選ばせない
CREATE FUNCTION public.prepare_desk_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner      UUID;
  v_title      TEXT;
  v_visibility TEXT;
BEGIN
  SELECT user_id, title, visibility INTO v_owner, v_title, v_visibility
  FROM public.desks WHERE id = NEW.desk_id;
  IF v_owner IS NULL OR v_visibility NOT IN ('public', 'unlisted') OR v_owner = NEW.reporter_id THEN
    RAISE EXCEPTION 'DESK_NOT_REPORTABLE' USING ERRCODE = '23503';
  END IF;
  NEW.desk_owner_id   := v_owner;
  NEW.desk_title      := v_title;
  NEW.status          := 'open';
  NEW.reviewed_at     := NULL;
  NEW.resolution_note := NULL;
  NEW.created_at      := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_desk_report() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER desk_reports_prepare
  BEFORE INSERT ON public.desk_reports
  FOR EACH ROW EXECUTE FUNCTION public.prepare_desk_report();

-- ─── 5) + 6) デスクへ写す持ち主の情報 ─────────────────────────
-- @ID は公開プロフィールを出している人の分だけ写す。owner_tier は写さない。
CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT
    CASE WHEN p.profile_discoverable THEN p.public_tag ELSE '' END,
    p.profile_discoverable,
    p.public_avatar_url
    INTO NEW.owner_tag, NEW.owner_profile_public, NEW.owner_avatar_url
  FROM public.profiles p
  WHERE p.id = NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS desks_set_owner_tag ON public.desks;
CREATE TRIGGER desks_set_owner_tag
  BEFORE INSERT OR UPDATE OF user_id, owner_tag, owner_profile_public, owner_avatar_url ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.set_desk_owner_tag();

DROP TRIGGER IF EXISTS profiles_sync_desk_owner_tier ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_desk_owner_tier();
ALTER TABLE public.desks DROP COLUMN IF EXISTS owner_tier;

-- 非公開にしている人の既存デスクから @ID を外す。owner_tag の書き換えは
-- update_updated_at（082）の除外列なので、みんなのデスクの並びは動かない。
-- 値は上のトリガが profiles から引き直す
UPDATE public.desks
SET owner_tag = ''
WHERE owner_profile_public = false AND owner_tag <> '';

-- ─── 7) 手放された @ID ─────────────────────────────────────────
-- 手放した本人は期間中も取り戻せる。アカウント削除で手放されたものは誰も取れない。
CREATE TABLE public.released_public_tags (
  tag_lower   TEXT PRIMARY KEY,
  released_by UUID,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.released_public_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.released_public_tags FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.public_tag_held_for_other(p_tag TEXT, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.released_public_tags
    WHERE tag_lower = LOWER(BTRIM(COALESCE(p_tag, '')))
      AND released_at > now() - INTERVAL '1 year'
      AND released_by IS DISTINCT FROM p_uid
  );
$$;

REVOKE ALL ON FUNCTION public.public_tag_held_for_other(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.release_public_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.released_public_tags (tag_lower, released_by)
    VALUES (LOWER(OLD.public_tag), NULL)
    ON CONFLICT (tag_lower) DO UPDATE SET released_by = NULL, released_at = now();
    RETURN OLD;
  END IF;

  IF LOWER(NEW.public_tag) IS DISTINCT FROM LOWER(OLD.public_tag) THEN
    INSERT INTO public.released_public_tags (tag_lower, released_by)
    VALUES (LOWER(OLD.public_tag), OLD.id)
    ON CONFLICT (tag_lower) DO UPDATE SET released_by = EXCLUDED.released_by, released_at = now();
    -- いま持っている @ID の控えは要らない（一意インデックスが守る）
    DELETE FROM public.released_public_tags WHERE tag_lower = LOWER(NEW.public_tag);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.release_public_tag() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_release_public_tag
  AFTER UPDATE OF public_tag ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.release_public_tag();

CREATE TRIGGER profiles_release_public_tag_on_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.release_public_tag();

-- 抽選（060）。控えにある @ID も避ける
CREATE OR REPLACE FUNCTION public.generate_public_tag()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 6));
    CONTINUE WHEN public.is_reserved_public_tag(candidate);
    CONTINUE WHEN public.public_tag_held_for_other(candidate, NULL);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE LOWER(public_tag) = LOWER(candidate)
    );
  END LOOP;
  RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_public_tag() FROM PUBLIC, anon, authenticated;

-- 061 の set_public_tag に、控えの確認を足しただけ。理由はアプリに出し分けない
-- （「使われています」と同じ扱い。誰が手放したかは答えない）
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
    ) OR public.public_tag_held_for_other(v_tag, v_uid) THEN
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

REVOKE ALL ON FUNCTION public.set_public_tag(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_public_tag(TEXT) TO authenticated;

-- 063 に控えの確認を足しただけ
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
  IF public.public_tag_held_for_other(v_tag, auth.uid()) THEN
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
