-- 楽天のレビュー件数。人気度の指標として使う。
--
-- 予測変換に出す商品を絞り込むのに、価格や在庫では判断できない。
-- レビュー件数は「実際に売れているか」を反映するので、
-- マイナー商品や古い機種を candidates から外す基準にできる。
alter table shop_links add column if not exists review_count integer;
