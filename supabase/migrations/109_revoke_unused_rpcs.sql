-- 109_revoke_unused_rpcs.sql
--
-- アプリ・Web・worker のどこからも呼ばれていないのに、ログインした人なら誰でも
-- 直接叩ける SECURITY DEFINER 関数の実行権限を外す（2026-10-14、総務省・NICT の
-- 「公開アプリを解析して接続先サーバを攻撃する手口（A2B 攻撃）」の注意喚起を受けた点検）。
--
-- アプリに入っている Supabase の URL と anon キーは誰でも取り出せるので、
-- アプリが使っていない RPC も攻撃面として残る。どれも RLS を素通りする関数で、
-- 使われていない分だけ中身の検査が追いつかなくなる。
--
--   get_desk_price_stats / get_desk_price_percentile / get_category_stats / get_monthly_adoption
--     … 028 の公開デスク横断の統計。画面からは使われていない
--   replace_desk_photos / replace_published_desk_content
--     … 009 / 040 の公開処理。publish_desk_snapshot（077）に置き換わり、アプリは呼んでいない
--
-- 関数本体は残す（運営の手元スクリプトや将来の再利用で service_role からは呼べる）。

REVOKE ALL ON FUNCTION public.get_desk_price_stats()                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_desk_price_percentile(INTEGER)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_category_stats()                                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_adoption(INTEGER)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_desk_photos(UUID, JSONB)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_published_desk_content(UUID, JSONB, JSONB)  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
