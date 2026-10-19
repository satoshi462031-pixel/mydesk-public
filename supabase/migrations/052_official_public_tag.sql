-- =============================================================
-- Migration 052: 公式アカウントの公開タグを #000000 に固定する
--
-- 049 のタグは gen_random_uuid() から作る 6 桁の 16 進数で、公式アカウントも
-- ランダムな値を持っていた。投稿者名（display_name）は誰でも自由に付けられる
-- ので、「MyDesk 公式」を名乗る他人と見分ける手がかりはタグしかない。
-- 覚えられる固定値にして、公式だけが持てるよう予約する。
--
-- 対象アカウントは公式デモデスクの所有者として引く。メールアドレス
-- （DEMO_DESK_EMAIL）はリポジトリに置けないが、デモデスクの id は
-- src/constants/demoDeskLinks.ts に入っていて、公開先と1対1で対応する。
-- =============================================================

-- ─── 1) 000000 を生成対象から外す ───────────────────────────────
-- 予約しないと、新規登録の抽選でいつか他人に配られる。公式の見分けが
-- タグ頼みである以上、なりすましの入口になる。
CREATE OR REPLACE FUNCTION public.generate_public_tag()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 6));
    CONTINUE WHEN candidate = '000000';
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE public_tag = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

-- ─── 2) 公式アカウントへ割り当てる ──────────────────────────────
DO $$
DECLARE
  -- src/constants/demoDeskLinks.ts の deskId。デモを作り直して id が
  -- 変わったら、このマイグレーションは対象を見つけられず何もしない。
  demo_desk_ids UUID[] := ARRAY[
    '1053c603-25cc-46cb-aa06-284ac9d2fbaf',
    '458fa607-269b-421d-a619-01375992fb97',
    'c40c79b0-5aaa-47fb-a271-a5e45026c230',
    'ebab39f1-c298-411a-9b79-40c89837e313'
  ]::UUID[];
  v_uid     UUID;
  v_current TEXT;
  v_holder  UUID;
BEGIN
  SELECT DISTINCT user_id INTO v_uid
  FROM public.desks
  WHERE id = ANY(demo_desk_ids)
  LIMIT 1;

  -- デモデスクを公開していない環境（ローカル・新規プロジェクト）では何もしない。
  -- ここで失敗させると db push が通らなくなる。
  IF v_uid IS NULL THEN
    RAISE NOTICE '052: 公式デモデスクが見つからないため公開タグの割り当てを飛ばした';
    RETURN;
  END IF;

  SELECT public_tag INTO v_current FROM public.profiles WHERE id = v_uid;
  IF v_current = '000000' THEN
    RAISE NOTICE '052: 公開タグは既に 000000';
    RETURN;
  END IF;

  -- 抽選で先に配られていた場合。黙って諦めると「公式が #000000」という
  -- 前提だけが崩れた状態で進むので、気づける形で止める。
  SELECT id INTO v_holder FROM public.profiles WHERE public_tag = '000000';
  IF v_holder IS NOT NULL THEN
    RAISE EXCEPTION '052: 公開タグ 000000 は別のユーザー(%)が使用中', v_holder;
  END IF;

  -- 049 のトリガはタグの変更を一切許さない。運用側からの意図的な付け替えとして
  -- ここだけ外す。アプリ経由では引き続き変更できない。
  ALTER TABLE public.profiles DISABLE TRIGGER profiles_public_tag_immutable;
  UPDATE public.profiles SET public_tag = '000000' WHERE id = v_uid;
  ALTER TABLE public.profiles ENABLE TRIGGER profiles_public_tag_immutable;

  -- desks.owner_tag は publishService がコピーする非正規化値なので、
  -- 公開済みのデモデスクを追随させる。050/051 の updated_at トリガは
  -- owner_name 以外の変更で時刻を進めるため、外してから更新する。
  -- ここで進めると、みんなのデスク（updated_at 降順）が公式デスクで埋まる。
  ALTER TABLE public.desks DISABLE TRIGGER desks_updated_at;
  UPDATE public.desks SET owner_tag = '000000'
  WHERE user_id = v_uid AND owner_tag IS DISTINCT FROM '000000';
  ALTER TABLE public.desks ENABLE TRIGGER desks_updated_at;

  RAISE NOTICE '052: 公開タグを 000000 に設定した (user=%)', v_uid;
END;
$$;

NOTIFY pgrst, 'reload schema';
