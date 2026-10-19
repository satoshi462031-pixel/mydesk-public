-- 商品マスタ + ショップリンク（アフィリエイトURL）
-- 商品情報とショップ情報を分離。1商品に複数ショップのリンクがぶら下がる。
-- 将来 Amazon PA-API / 楽天API から自動更新する場合も同じテーブルに書き込む。

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  asin        text,                 -- Amazon ASIN（PA-API 移行後の同定キー）
  name        text not null,
  brand       text,
  category    text,                 -- GadgetCategory と同じ文字列（'Monitor' など）
  image       text,
  description text,
  created_at  timestamptz not null default now()
);

create unique index if not exists products_asin_key on products (asin) where asin is not null;
create index if not exists products_name_idx on products (lower(name));

create table if not exists shop_links (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  shop          text not null,      -- 'amazon_jp' / 'amazon_us' / 'rakuten_jp' / 'yahoo_jp' / 'official'
  country       text not null,      -- 'JP' / 'US'
  affiliate_url text,
  official_url  text,
  price         integer,            -- 将来: 価格比較
  currency      text,
  in_stock      boolean,            -- 将来: 在庫取得
  last_updated  timestamptz not null default now()
);

create index if not exists shop_links_product_idx on shop_links (product_id);
create unique index if not exists shop_links_product_shop_key on shop_links (product_id, shop);

-- 誰でも読み取り可・書き込みは service_role のみ（管理側で登録する）
alter table products enable row level security;
alter table shop_links enable row level security;

create policy "products_read_all" on products for select using (true);
create policy "shop_links_read_all" on shop_links for select using (true);
