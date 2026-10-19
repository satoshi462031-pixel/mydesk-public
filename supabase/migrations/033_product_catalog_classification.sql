alter table products
  add column if not exists subcategory text,
  add column if not exists is_suggestable boolean not null default true;

create index if not exists products_category_subcategory_idx
  on products (category, subcategory);

create index if not exists products_suggestable_idx
  on products (is_suggestable)
  where is_suggestable = true;
