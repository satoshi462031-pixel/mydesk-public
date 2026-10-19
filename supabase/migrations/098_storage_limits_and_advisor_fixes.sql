-- =============================================================
-- Migration 098: 写真バケットに形式と大きさの上限を付け、Supabase の診断（advisors）の指摘を直す
--
-- 1. desk-images は誰でも URL で読める公開バケットで、形式も大きさも制限していなかった。
--    ポリシーは「自分のフォルダだけ」に絞ってあるが、ログインした人なら自分のフォルダに
--    画像以外のファイル（HTML など）や巨大なファイルを置け、このドメインから配れてしまう。
--    アプリとデモの公開スクリプトが上げるのは JPEG（長辺1920px・品質0.82、実測の最大は約640KB）
--    だけなので、JPEG と 5MB に絞る。
-- 2. トリガー用の関数に anon / authenticated の実行権限が残っていた（RPC の口として見える）。
--    トリガーの外では実行できないが、口を閉じておく。トリガーの発火は実行権限を確かめない
--    （確かめるのは CREATE TRIGGER のときだけ）ので、動きは変わらない。
--    scripts/functionGrants.ts はトリガー関数を対象外にしているので、監査とはぶつからない。
-- 3. search_path を固定していない関数を固定する。どれも呼び出した人の権限で動き
--    （SECURITY INVOKER）、本体は組み込みの関数しか使っていない。
-- 4. 同じ列に同じインデックスが2本あった（001 と 002 が別名で作っていた）。001 側を落とす。
-- 5. 本番にだけ残っていた、どのトリガーからも使われていない関数を落とす（マイグレーションには無い）。
-- =============================================================

-- 1. 写真バケットの形式と大きさ
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg'],
    file_size_limit = 5242880
WHERE id = 'desk-images';

-- 2. トリガー関数の実行権限
REVOKE EXECUTE ON FUNCTION public.enforce_desk_photo_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_desk_version_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_desk_like_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trim_backups() FROM PUBLIC, anon, authenticated;

-- 3. search_path の固定
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.protect_profile_tier() SET search_path = public;
ALTER FUNCTION public.protect_profile_official() SET search_path = public;
ALTER FUNCTION public.is_reserved_public_tag(text) SET search_path = public;

-- 4. 重複したインデックス（desk_versions_desk_id_idx を残す）
DROP INDEX IF EXISTS public.idx_desk_versions_desk;

-- 5. 使われていない関数
DROP FUNCTION IF EXISTS public.update_updated_at_column();
