-- =============================================================
-- Migration 074: お気に入りブランド
--
-- 保存（gadget_bookmarks）が「この商品が欲しい」なら、こちらは
-- 「このメーカーを追っている」。デスク環境はブランド指名買いが強い領域で、
-- キーボードも充電器も「まず Keychron を見る」から始まる人がいる。
--
-- **持つのはキーだけで、商品との関連は持たない。**
-- products.brand は importRakutenGenres.ts の detectBrand が商品名の先頭から
-- 抜いた文字列なので表記ゆれがある（Anker / anker / ANKER）。関連を行で持つと
-- 表記ごとに別ブランドとして増えるので、束ねた結果の brand_key だけを保存し、
-- 商品の引き当ては読むたびに src/utils/brandIdentity.ts の別名表で行う。
-- 辞書を直せば過去のフォローにも即座に効く。
--
-- brand_key は英字表記を潰したもの（compactBrand の結果）。表に無いブランドは
-- 潰した表記そのものがキーになるので、辞書に追加しても既存の行は壊れない
-- （追加後は同じ raw から同じ id が返る）。
--
-- 集計は出さない。「何人がフォローしているか」は購入検証のない人気度になり、
-- 066 でガジェットの「いいね」を作らなかったのと同じ理由で持たない。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.brand_follows (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- brandKey() が返す値。長さは辞書の最長より十分広く取る
  brand_key  TEXT NOT NULL CHECK (char_length(brand_key) BETWEEN 1 AND 80),
  -- 押した時点の表記。辞書に無いブランドの表示名として使う（キーは小文字に
  -- 潰れているので、これが無いと画面に "ugreen" と出る）
  brand_label TEXT NOT NULL CHECK (char_length(brand_label) BETWEEN 1 AND 120),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同じブランドを2回フォローできない
CREATE UNIQUE INDEX IF NOT EXISTS brand_follows_user_brand_idx
  ON public.brand_follows (user_id, brand_key);

CREATE INDEX IF NOT EXISTS idx_brand_follows_user_created
  ON public.brand_follows (user_id, created_at DESC);

ALTER TABLE public.brand_follows ENABLE ROW LEVEL SECURITY;

-- 他人が誰を追っているかは読めない。集計を出さないので公開する理由が無い
CREATE POLICY "brand_follows_select_own" ON public.brand_follows
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "brand_follows_insert_own" ON public.brand_follows
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "brand_follows_delete_own" ON public.brand_follows
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
