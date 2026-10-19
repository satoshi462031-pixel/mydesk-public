-- 商品の出典。楽天ジャンルからの大量取り込み（scripts/importRakutenGenres.ts）で
-- 手書きプリセット（gadgetPresets.ts）と楽天由来の商品が同じテーブルに混ざるため。
--
-- 予測変換ではプリセットを優先したい。楽天の商品名は
-- 「【送料無料】【楽天1位】ロジクール MX MASTER 3S ワイヤレスマウス MX2300GR」
-- のような形で、正規名としては使えないものが多い。
alter table products add column if not exists source text not null default 'preset';

create index if not exists products_source_idx on products (source);
