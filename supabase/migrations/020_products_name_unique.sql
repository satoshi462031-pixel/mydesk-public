-- 商品名を同定キーにする（scripts/importRakuten.ts の upsert 先）
--
-- products.name はアプリ内の正規名（gadgetPresets.ts の name）をそのまま入れる。
-- 楽天から返る商品名は「【送料無料】…」等のノイズを含み、
-- SupabaseProductRepository.findBestLink() が name 完全一致で引くため使えない。
-- 取り込みを何度回しても行が増えないよう unique にしておく。
create unique index if not exists products_name_key on products (name);
