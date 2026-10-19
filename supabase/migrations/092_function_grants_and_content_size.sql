-- =============================================================
-- Migration 092: 関数の実行権限の取りこぼしと、書き込める値の大きさの上限
--
-- ■ 1) 091 の関数を anon / authenticated から外す
--   Supabase は public スキーマの新しい関数に ALTER DEFAULT PRIVILEGES で
--   anon / authenticated へ EXECUTE を個別に付ける。REVOKE ... FROM PUBLIC だけでは
--   剥がれない（015・019 の教訓）。091 はそれだけだったので、
--   ・bump_desk_traffic を誰でも直接呼べて、Web の閲覧数を名乗って水増しできた
--   ・admin_desk_traffic（運営の集計）を誰でも読めた
--   以後は scripts/auditFunctionGrants.ts（npm run audit:function-grants）が止める。
--
-- ■ 2) 利用者が書く列の大きさ
--   デスク名・説明・共有スナップショット・機材名・プロフィールに上限が無く、
--   改造したアプリから数MBの題名で公開すると、みんなのデスク・検索を開いた全員が
--   それを受け取る（表示崩れと転送量の課金）。アプリの入力上限より十分広く取り、
--   正規の操作では当たらない値にする。
--   既存の行は NOT VALID で検査しない（045 の backups と同じ）。新しい書き込みだけを見る。
-- =============================================================

-- ─── 1) 実行権限 ─────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.bump_desk_traffic(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_desk_traffic(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.admin_desk_traffic(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_desk_traffic(INTEGER) TO service_role;

-- SECURITY DEFINER の関数（handle_new_user・set_public_tag）の中からしか使わない。
-- 定義者の権限で走るので、呼び出し側のロールから外しても動く
REVOKE ALL ON FUNCTION public.generate_public_tag() FROM PUBLIC, anon, authenticated;

-- 090 も FROM PUBLIC だけだった。本体が他人の ID を弾くので実害は無いが、未ログインで呼ぶ理由も無い
REVOKE ALL ON FUNCTION public.is_pro_user(UUID) FROM anon;

-- ─── 2) 大きさの上限 ─────────────────────────────────────────
-- アプリ側の上限：デスク名 30・表示名 20・機材名 100（src/constants/textLimits.ts）
ALTER TABLE public.desks
  DROP CONSTRAINT IF EXISTS desks_title_size,
  DROP CONSTRAINT IF EXISTS desks_description_size,
  DROP CONSTRAINT IF EXISTS desks_owner_name_size,
  DROP CONSTRAINT IF EXISTS desks_share_snapshot_size,
  DROP CONSTRAINT IF EXISTS desks_labels_size;
ALTER TABLE public.desks
  ADD CONSTRAINT desks_title_size CHECK (char_length(title) <= 100) NOT VALID,
  ADD CONSTRAINT desks_description_size CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID,
  ADD CONSTRAINT desks_owner_name_size CHECK (char_length(owner_name) <= 50) NOT VALID,
  -- 共有スナップショットは公開ページがそのまま描く。バックアップ1件（045）の半分
  ADD CONSTRAINT desks_share_snapshot_size CHECK (octet_length(share_snapshot::TEXT) <= 2097152) NOT VALID,
  ADD CONSTRAINT desks_labels_size CHECK (
    cardinality(purposes) <= 30 AND octet_length(array_to_string(purposes, ',')) <= 4000
    AND cardinality(attributes) <= 30 AND octet_length(array_to_string(attributes, ',')) <= 4000
  ) NOT VALID;

ALTER TABLE public.devices
  DROP CONSTRAINT IF EXISTS devices_name_size,
  DROP CONSTRAINT IF EXISTS devices_category_size,
  DROP CONSTRAINT IF EXISTS devices_ports_size,
  DROP CONSTRAINT IF EXISTS devices_brand_size;
ALTER TABLE public.devices
  ADD CONSTRAINT devices_name_size CHECK (char_length(name) <= 300) NOT VALID,
  ADD CONSTRAINT devices_category_size CHECK (char_length(category) <= 100) NOT VALID,
  ADD CONSTRAINT devices_ports_size CHECK (octet_length(ports::TEXT) <= 65536) NOT VALID,
  -- publish_desk_snapshot は 80 字・12 件で切るが、REST から直接入れる経路は切られない
  ADD CONSTRAINT devices_brand_size CHECK (
    (brand IS NULL OR char_length(brand) <= 200)
    AND (brand_aliases IS NULL OR (cardinality(brand_aliases) <= 20 AND octet_length(array_to_string(brand_aliases, ',')) <= 4000))
  ) NOT VALID;

ALTER TABLE public.connections
  DROP CONSTRAINT IF EXISTS connections_cable_type_size,
  DROP CONSTRAINT IF EXISTS connections_label_size;
ALTER TABLE public.connections
  ADD CONSTRAINT connections_cable_type_size CHECK (char_length(cable_type) <= 100) NOT VALID,
  ADD CONSTRAINT connections_label_size CHECK (label IS NULL OR char_length(label) <= 200) NOT VALID;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_display_name_size,
  DROP CONSTRAINT IF EXISTS profiles_bio_size,
  DROP CONSTRAINT IF EXISTS profiles_username_size;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_size CHECK (display_name IS NULL OR char_length(display_name) <= 50) NOT VALID,
  ADD CONSTRAINT profiles_bio_size CHECK (bio IS NULL OR char_length(bio) <= 1000) NOT VALID,
  -- handle_new_user がメールアドレスから作る。RFC 5321 の上限に合わせる
  ADD CONSTRAINT profiles_username_size CHECK (username IS NULL OR char_length(username) <= 320) NOT VALID;

-- 公開デスクの成長記録は誰でも読める（001 の desk_versions_select）
ALTER TABLE public.desk_versions
  DROP CONSTRAINT IF EXISTS desk_versions_name_size,
  DROP CONSTRAINT IF EXISTS desk_versions_snapshot_size;
ALTER TABLE public.desk_versions
  ADD CONSTRAINT desk_versions_name_size CHECK (char_length(version_name) <= 200) NOT VALID,
  ADD CONSTRAINT desk_versions_snapshot_size CHECK (octet_length(snapshot::TEXT) <= 2097152) NOT VALID;

-- ─── 3) 1デスクあたりの機材・接続の数 ─────────────────────────
-- publish_desk_snapshot は渡された配列をそのまま行にする。1件ずつの大きさを縛っても、
-- 数十万行を積まれれば公開ページと DB が埋まる。078 と同じくデスクの行をロックしてから数える。
-- publish_desk_snapshot は消してから入れ直すので、数は常に今回の台数
CREATE OR REPLACE FUNCTION public.enforce_desk_device_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.desks WHERE id = NEW.desk_id FOR UPDATE;
  IF TG_TABLE_NAME = 'devices' THEN
    IF (SELECT count(*) FROM public.devices WHERE desk_id = NEW.desk_id) >= 500 THEN
      RAISE EXCEPTION 'desk device limit reached' USING ERRCODE = '23514';
    END IF;
  ELSIF (SELECT count(*) FROM public.connections WHERE desk_id = NEW.desk_id) >= 2000 THEN
    RAISE EXCEPTION 'desk connection limit reached' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_desk_device_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_desk_device_limit ON public.devices;
CREATE TRIGGER trg_enforce_desk_device_limit
  BEFORE INSERT ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.enforce_desk_device_limit();

DROP TRIGGER IF EXISTS trg_enforce_desk_connection_limit ON public.connections;
CREATE TRIGGER trg_enforce_desk_connection_limit
  BEFORE INSERT ON public.connections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_desk_device_limit();

NOTIFY pgrst, 'reload schema';
