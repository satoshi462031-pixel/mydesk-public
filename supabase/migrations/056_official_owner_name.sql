-- =============================================================
-- Migration 056: 公式アカウントの投稿者名を両言語で読める表記にする
--
-- publicAuthor.ts は英語表示のときだけ投稿者名を 'MyDesk Official' に
-- 差し替えていた。公式バッジではなく、owner_name が日本語であることへの
-- 当て物で、表示言語で投稿者名が変わるのは名前としておかしい。
-- コード側の差し替えを消したので、名前そのものを英語でも通る表記にする。
--
-- なりすまし対策は 052 のタグ予約（#000000 を抽選から外して公式に固定）が
-- 担っている。名前は誰でも名乗れるので、ここは識別の役目を持たない。
-- 055 の検索は '#000000' のデスクを 'MyDesk Official / MyDesk 公式' で
-- 引けるようにしており、そちらは名前に依存しないので触らない。
--
-- 対象は 052 と同じ引き方（公式デモデスクの所有者）。
-- =============================================================

DO $$
DECLARE
  -- src/constants/demoDeskLinks.ts の deskId。052 と同じ並び。
  -- デモを作り直して id が変わったら、このマイグレーションは何もしない。
  demo_desk_ids UUID[] := ARRAY[
    '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
    '458fa607-269b-421d-a619-01375992fb97',
    'c40c79b0-5aaa-47fb-a271-a5e45026c230',
    'ebab39f1-c298-411a-9b79-40c89837e313'
  ]::UUID[];
  official_name CONSTANT TEXT := 'MyDesk';
  v_uid UUID;
BEGIN
  SELECT DISTINCT user_id INTO v_uid
  FROM public.desks
  WHERE id = ANY(demo_desk_ids)
  LIMIT 1;

  -- デモデスクを公開していない環境（ローカル・新規プロジェクト）では何もしない。
  -- ここで失敗させると db push が通らなくなる。
  IF v_uid IS NULL THEN
    RAISE NOTICE '056: 公式デモデスクが見つからないため投稿者名の変更を飛ばした';
    RETURN;
  END IF;

  UPDATE public.profiles SET display_name = official_name WHERE id = v_uid;

  -- desks.owner_name は publishService がコピーする非正規化値。公開済みの
  -- デモデスクを追随させる。051 のトリガは owner_name だけの変更で
  -- updated_at を進めないので、みんなのデスクの並びは動かない。
  UPDATE public.desks SET owner_name = official_name
  WHERE user_id = v_uid AND owner_name IS DISTINCT FROM official_name;

  RAISE NOTICE '056: 公式アカウントの投稿者名を % にした (user=%)', official_name, v_uid;
END;
$$;
