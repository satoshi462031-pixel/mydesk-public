-- 元のEC出品タイトルと、アプリに表示する製品名を分離する。
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_name TEXT;

-- 手書きプリセットは既に正規名なので初期値として利用できる。
UPDATE public.products
SET product_name = name
WHERE source = 'preset' AND product_name IS NULL;

COMMENT ON COLUMN public.products.name IS
  '検索・監査・ショップ照合用の元商品タイトル';
COMMENT ON COLUMN public.products.product_name IS
  'ブランドを含まない画面表示用の正規製品名';

CREATE INDEX IF NOT EXISTS products_product_name_idx
  ON public.products (lower(product_name))
  WHERE product_name IS NOT NULL;

NOTIFY pgrst, 'reload schema';
