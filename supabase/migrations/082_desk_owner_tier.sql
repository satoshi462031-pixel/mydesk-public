-- =============================================================
-- Migration 082: デスクの歴史を遡れる年数を「投稿者の契約」で決める
--
-- これまでは閲覧側で決めていた。DeskHistoryEntryCard が
--   readOnly ? -1 : getLimit('historyAnimationYears')
-- として、他人のデスクでは誰でも全期間を再生できた。2つ問題がある。
--
--   1. 無料の投稿者が自分のデスクを公開し、その公開ページを開くと、
--      マイデスク側の1年の上限を抜けて自分の全履歴を再生できた
--   2. 「1年より前は Pro」の文言が、他人のデスクを見ている課金者にも出る
--
-- 投稿者の契約で決める形にすると、同じデスクは誰が見ても同じ範囲になる。
-- 閲覧者の契約で変えると、**同じ無料投稿者のデスクが、見に来た人の契約に
-- よって見える範囲が変わる**ことになり、投稿者は自分の履歴がどこまで
-- 公開されているかを把握できない。他人のデータの露出範囲を、その人以外の
-- 契約で決めるべきではない。
--
-- profiles は 046 で本人しか読めず、閲覧側から join できない。
-- owner_tag（049）・owner_profile_public（057）・owner_avatar_url（059）と
-- 同じく desks へ非正規化してコピーする。
--
-- なお share_snapshot には全期間の日付が載ったまま届く。これは表示上の
-- 線引きであって秘匿の境界ではない（デスク自体は投稿者が公開を選んだもの）。
-- 本当に出さないなら公開時か API 側で削る必要がある。
-- =============================================================

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS owner_tier TEXT NOT NULL DEFAULT 'free';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.desks'::regclass
      AND conname = 'desks_owner_tier_check'
  ) THEN
    ALTER TABLE public.desks
      ADD CONSTRAINT desks_owner_tier_check CHECK (owner_tier IN ('free', 'pro'));
  END IF;
END;
$$;

-- ─── 1) 契約の変化で並び順を動かさない ──────────────────────────
-- 081 の形（除外列を1箇所に並べる）をそのまま踏襲して owner_tier を足す。
-- 足さないと、解約・更新のたびにその人の公開デスクが一斉に
-- updated_at 降順のフィード先頭へ上がる（051 / 054 / 057 / 059 / 060 と同じ問題）。
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- 以下の列**だけ**が変わった更新では、並び順を動かさないため updated_at を据え置く。
  --   owner_name / owner_profile_public / owner_avatar_url / owner_tag / owner_tier
  --     … プロフィール側の設定・契約の変更が、自分のデスクを一斉にフィードの先頭へ押し上げるのを防ぐ（051 / 057 / 059 / 060 / 082）
  --   like_count
  --     … 他人のいいねで並び順が動くのを防ぐ（054）
  IF (to_jsonb(NEW) - 'updated_at' - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'owner_tag' - 'owner_tier' - 'like_count')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'owner_tag' - 'owner_tier' - 'like_count')
  THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 2) 新しいデスクにも本人の契約をコピーする ────────────────────
-- 059 の定義に owner_tier を足したもの。クライアントが値を偽装しても、
-- 所有者の profiles にある確定値で上書きする。
CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT public_tag, profile_discoverable, public_avatar_url, tier
    INTO NEW.owner_tag, NEW.owner_profile_public, NEW.owner_avatar_url, NEW.owner_tier
  FROM public.profiles
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS desks_set_owner_tag ON public.desks;
CREATE TRIGGER desks_set_owner_tag
  BEFORE INSERT OR UPDATE OF user_id, owner_tag, owner_profile_public, owner_avatar_url, owner_tier ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.set_desk_owner_tag();

-- ─── 3) 契約が変わったら公開中のデスクへ伝える ────────────────────
-- owner_tag は 049 で変更禁止、owner_profile_public と owner_avatar_url は
-- 本人が押す RPC があるので、どちらも profiles 側のトリガを持っていない。
-- tier は RevenueCat の Webhook（update_user_tier / apply_revenuecat_event）が
-- 書き、本人の操作を経ない。書き込み経路ごとに UPDATE を足すと、経路が増えた
-- ときに素通りする（069 が「経路ごとにポリシーへ条件を足すのはやめる」と
-- 書いたのと同じ理由）ので、列に対するトリガにする。
CREATE OR REPLACE FUNCTION public.sync_desk_owner_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.desks
  SET owner_tier = NEW.tier
  WHERE user_id = NEW.id
    AND owner_tier IS DISTINCT FROM NEW.tier;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_desk_owner_tier ON public.profiles;
CREATE TRIGGER profiles_sync_desk_owner_tier
  AFTER UPDATE OF tier ON public.profiles
  FOR EACH ROW
  WHEN (NEW.tier IS DISTINCT FROM OLD.tier)
  EXECUTE FUNCTION public.sync_desk_owner_tier();

-- ─── 4) 既存デスクの補完（並び順を動かさない）────────────────────
-- 049 / 057 と同じ手順で updated_at のトリガを外して埋める。
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
SET owner_tier = p.tier
FROM public.profiles AS p
WHERE d.user_id = p.id
  AND d.owner_tier IS DISTINCT FROM p.tier;

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

REVOKE ALL ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_desk_owner_tier() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
