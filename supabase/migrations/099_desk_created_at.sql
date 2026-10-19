-- =============================================================
-- Migration 099: デスクを作った日時（desks.desk_created_at）
--
-- desks.created_at は「初めて公開した日時」で、デスクを作った日とは別物。
-- 作った日は端末の DeskPlan.createdAt にしか無く、公開デスクの詳細に出すには
-- サーバーにも持たせる必要がある。今は表示せず、記録だけしておく。
--
-- 値は公開のたびに端末が送る（持ち主の自己申告）。既存行の backfill はしない
-- （作った日はサーバーからは分からない。次の公開で埋まる）。
-- 旧クライアントは送らないので NULL のまま残る。読む側は created_at へ戻すこと。
-- =============================================================

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS desk_created_at TIMESTAMPTZ;

COMMENT ON COLUMN public.desks.desk_created_at IS
  'デスクを作った日時（端末の DeskPlan.createdAt）。公開のたびに端末が送る。未送信の行は NULL';
