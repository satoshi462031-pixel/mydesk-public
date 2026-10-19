-- =============================================================
-- 029_desk_stats_revoke_anon.sql
--   028 で追加した統計RPCを anon から剥がす。
--
--   Supabase は public スキーマの関数に anon / authenticated への EXECUTE を
--   既定で付与するため、028 の "REVOKE ALL ... FROM PUBLIC" では anon の権限が
--   残っていた（015 の冒頭に同じ注意書きがある）。実際、未認証のリクエストで
--   4関数とも 200 が返る状態だった。
--
--   集計対象は公開デスクのみなので情報としての機微は低いが、認証済みユーザー
--   向けの機能なので実行者も揃える。LP から数値を出したくなった場合は
--   anon へ GRANT し直すか、集計済みの値を別途配信する。
-- =============================================================

REVOKE EXECUTE ON FUNCTION public.get_desk_price_stats()             FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_desk_price_percentile(INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_category_stats()               FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_monthly_adoption(INTEGER)      FROM anon;

NOTIFY pgrst, 'reload schema';
