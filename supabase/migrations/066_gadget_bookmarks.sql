-- =============================================================
-- Migration 066: 公開デスクで見つけたガジェットを「欲しい」として残す
--
-- ガジェット単位の「いいね」は作らない。
--
-- 当初案は gadget_likes と gadget_bookmarks を対で作っていたが、どちらも
-- select_own（他人の行は誰も読めない）だったため集計が出せず、いいねは
-- 「自分だけが見える2つ目のリスト」になって保存と機能的に同じものになっていた。
-- デスク側のハートが意味を持つのは desks.like_count として相手に届くからで、
-- 商品には届く相手がいない。
--
-- 公開カウントを足せば意味は出るが、そうすると購入検証のないレビュー点数になる。
-- 母数も使用期間も外した人の記録も無い数字で、アプリはもっと強い数字
-- （使用者数・継続率）を持てる側にいる。アフィリエイトリンクの隣に評点を置くのは
-- 景表法側のリスクも増やす。
--
-- 残す「保存」はウィッシュリストとして機能させる。欲望の瞬間と決定の瞬間を
-- 分けられるので互換ミスの買い直しが減り、「持っていないが欲しいもの」という
-- 第一者データが初めて取れる（いまは所有しか分からない）。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.gadget_bookmarks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 商品マスタが引けたものはこれが同一性。予測変換を通っていないものは NULL
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  gadget_name     TEXT NOT NULL CHECK (char_length(gadget_name) BETWEEN 1 AND 300),
  gadget_category TEXT NOT NULL CHECK (char_length(gadget_category) BETWEEN 1 AND 80),

  -- どこで見つけたか。**同一性ではないので NULL 可。**
  -- ON DELETE CASCADE にしてはいけない。見つけた元のデスクが非公開化・削除された
  -- だけで欲しいものリストから消えるのは、リストとして使えない
  -- （ウィッシュリストは出典より長生きしなければならない）。
  -- 自分の持ち物の画面から保存したものは、そもそも出典が無い
  desk_id         UUID REFERENCES public.desks(id) ON DELETE SET NULL,
  gadget_id       TEXT CHECK (gadget_id IS NULL OR char_length(gadget_id) BETWEEN 1 AND 200),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 畳む単位は商品。当初案の UNIQUE (user_id, desk_id, gadget_id) だと、
-- 同じマウスを3人のデスクから保存すると3行並ぶ。
--
-- 生成列（coalesce(product_id::text, …)）で1本の一意制約にしないのは、
-- uuid → text が I/O 変換キャストで、生成列に要求される immutable 判定が
-- PostgreSQL のバージョンに依存するため。部分索引なら意図もそのまま読める。
-- 後から同じ商品に product_id が付いた行は別行として残る（無理に寄せない）。
CREATE UNIQUE INDEX IF NOT EXISTS gadget_bookmarks_user_product_idx
  ON public.gadget_bookmarks (user_id, product_id)
  WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gadget_bookmarks_user_name_idx
  ON public.gadget_bookmarks (user_id, lower(gadget_name), lower(gadget_category))
  WHERE product_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_gadget_bookmarks_user_created
  ON public.gadget_bookmarks (user_id, created_at DESC);
-- 「この商品を何人が欲しがっているか」を集計する側の索引。行そのものは本人しか
-- 読めないので、数を出すなら SECURITY DEFINER の集計関数を別途足してから
CREATE INDEX IF NOT EXISTS idx_gadget_bookmarks_product
  ON public.gadget_bookmarks (product_id)
  WHERE product_id IS NOT NULL;

ALTER TABLE public.gadget_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gadget_bookmarks_select_own" ON public.gadget_bookmarks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 出典を付けるなら公開デスクだけ（非公開デスクの中身を辿れる穴にしない）。
-- 出典なしの保存は通す：自分の持ち物の詳細シートからも「欲しい」を押せる
-- ようにするため（買い替え候補は自分のマウスの画面から探しはじめる）。
-- 当初案は「公開かつ自分のものでない」を必須にしていたので、そこが塞がっていた。
CREATE POLICY "gadget_bookmarks_insert_own" ON public.gadget_bookmarks
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = user_id AND (
      desk_id IS NULL OR EXISTS (
        SELECT 1 FROM public.desks
        WHERE desks.id = gadget_bookmarks.desk_id
          AND desks.visibility = 'public'
      )
    )
  );

CREATE POLICY "gadget_bookmarks_delete_own" ON public.gadget_bookmarks
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

REVOKE ALL ON public.gadget_bookmarks FROM anon;
GRANT SELECT, INSERT, DELETE ON public.gadget_bookmarks TO authenticated;

NOTIFY pgrst, 'reload schema';
