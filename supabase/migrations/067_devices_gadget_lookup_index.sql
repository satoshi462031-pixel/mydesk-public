-- =============================================================
-- Migration 067: ガジェット詳細から「このガジェットを使っている公開デスク」を逆引きする
--
-- devices はこれまで desk_id からしか引かれていない（デスク1件を開いて機材を並べる）。
-- 逆向き、つまり「この名前・このカテゴリの機材を持っているデスク」を引くと
-- devices の全件走査になり、ガジェットのシートを開くたびに公開デスクの総数ぶん重くなる。
--
-- 照合キーが name + category なのは、devices に商品 ID の列が無いため。
-- 009 の atomic publish が書くのは name / category / price / ports / 日付だけで、
-- productId は share_snapshot の JSON の中にしかなく、一覧の照合には使えない。
-- =============================================================

CREATE INDEX IF NOT EXISTS devices_name_category_idx
  ON public.devices (name, category);

NOTIFY pgrst, 'reload schema';
