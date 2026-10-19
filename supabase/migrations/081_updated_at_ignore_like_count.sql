-- =============================================================
-- Migration 081: いいねで desks.updated_at を進めない（054 の例外を戻す）
--
-- update_updated_at() は 050 以降 6 回書き換えられている。除外する列の変遷は
--
--   051  owner_name
--   054  like_count（051 の形を捨てて置き換え）
--   057  owner_name + owner_profile_public
--   059  + owner_avatar_url
--   060  + owner_tag
--
-- で、057 が 051 の形を下敷きに書き直したときに 054 の like_count が落ち、
-- 以降どの版にも戻っていない。結果、いいねを 1 つ押すと
-- likes への INSERT → sync_desk_like_count の UPDATE → このトリガ、と伝わって
-- updated_at が now() になる。みんなのデスク・検索・公開プロフィールはどれも
-- updated_at 降順なので、**いいねされたデスクが一覧の先頭に上がる**。
-- 054 が「フィードの並び順や保存一覧の更新表示を動かさないため」と書いて
-- 防いでいたものが、そのまま戻っていた。
--
-- 061 以前に公開したきり再公開していないデスクは content_updated_at が NULL で、
-- 保存一覧の「更新あり」が updated_at に落ちる（bookmarkSeen の deskUpdateStamp）。
-- そのぶんは、いいねのたびにバッジが出ていたことになる。
--
-- **書き方を 054 の形に戻す。** 060 までの形は「この列が変わった」条件と
-- to_jsonb からの減算に同じ列名を 2 度書く必要があり、列が増えるたびに
-- 片方を書き忘れる（実際 like_count はこれで落ちた）。除外列を 1 箇所に
-- 並べる形なら、次に足す人が 1 行直せば済む。
--
-- 挙動の差は「どの列も変わらない UPDATE」のときだけで、060 の形は
-- updated_at を進め、この形は据え置く。据え置くほうが正しい。
--
-- content_updated_at は除外しない。あれは content_signature が変わったときに
-- だけ 061 のトリガが動かす列で、中身が変わった＝updated_at も進むべき場面。
-- =============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- 以下の列**だけ**が変わった更新では、並び順を動かさないため updated_at を据え置く。
  --   owner_name / owner_profile_public / owner_avatar_url / owner_tag
  --     … プロフィール側の設定変更が、自分のデスクを一斉にフィードの先頭へ押し上げるのを防ぐ（051 / 057 / 059 / 060）
  --   like_count
  --     … 他人のいいねで並び順が動くのを防ぐ（054）
  IF (to_jsonb(NEW) - 'updated_at' - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'owner_tag' - 'like_count')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'owner_name' - 'owner_profile_public' - 'owner_avatar_url' - 'owner_tag' - 'like_count')
  THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
