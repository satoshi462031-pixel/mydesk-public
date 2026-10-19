-- 107_revenuecat_customer_id.sql
--
-- RevenueCat の顧客 ID（app_user_id）を、Supabase の利用者 ID から本人しか知らない値へ切り替える。
--
-- これまでアプリは Purchases.logIn(user.id) としていた。利用者 ID は公開デスクの user_id と
-- 写真の URL（desk-images/<user_id>/...）から誰でも拾え、アプリに同梱の公開キーで
-- GET /v1/subscribers/<user_id> を呼ぶと、その人の加入中のプラン・購入日・最終利用日時まで返る
-- （2026-10-13 に公式デモアカウントで再現）。公開キーは呼び手が本人だと証明できないので、
-- 推測できない ID を本人にだけ見せる以外に防ぎようがない。
--
-- profiles は本人しか読めない（046）。値は作成時に決まり、本人からは変えられない。
-- 変えられると、他人の購入が付いた顧客 ID を名乗って sync-subscription に Pro を書かせられる。

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rc_customer_id UUID;
UPDATE public.profiles SET rc_customer_id = gen_random_uuid() WHERE rc_customer_id IS NULL;
ALTER TABLE public.profiles
  ALTER COLUMN rc_customer_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN rc_customer_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_rc_customer_id_key ON public.profiles (rc_customer_id);

COMMENT ON COLUMN public.profiles.rc_customer_id IS
  'RevenueCat の app_user_id。本人だけが読める。利用者 ID は公開されているので顧客 ID に使わない（107）';

CREATE FUNCTION public.protect_profile_rc_customer_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.rc_customer_id := gen_random_uuid();
  ELSE
    NEW.rc_customer_id := OLD.rc_customer_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_profile_rc_customer_id() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER profiles_protect_rc_customer_id
  BEFORE INSERT OR UPDATE OF rc_customer_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_rc_customer_id();

NOTIFY pgrst, 'reload schema';
