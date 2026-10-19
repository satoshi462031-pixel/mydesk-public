-- 公開デスクの検索ページを mydesk.page/explore に移した。1段目のパスは @ID のプロフィール
-- （mydesk.page/<@ID>）と同じ場所を分け合うので、explore を名乗れないようにする。
-- 2026-10-15 時点で explore を名乗っている人はいない（本番の profiles を確認済み）。
-- 一覧はアプリの RESERVED_TAGS（src/utils/publicTag.ts）と揃える。
CREATE OR REPLACE FUNCTION public.is_reserved_public_tag(p_tag TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT LOWER(BTRIM(COALESCE(p_tag, ''))) = ANY (ARRAY[
    'mydesk', 'my_desk', 'mydeskofficial', 'mydesk_official', 'mydeskjp', 'mydeskapp',
    'official', 'admin', 'administrator', 'moderator', 'staff', 'support', 'help',
    'info', 'contact', 'security', 'billing', 'root', 'system', 'null', 'undefined',
    'api', 'app', 'www', 'u', 'd', 'desk', 'setup', 'settings', 'login', 'signin',
    'signup', 'terms', 'privacy', 'about', 'blog', 'explore', '000000'
  ]);
$$;
