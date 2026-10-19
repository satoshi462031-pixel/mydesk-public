-- 公開時点のプランとガジェットを完全なスナップショットとして保持する。
-- devices / connections は一覧・集計・旧クライアント互換のため引き続き保存する。
ALTER TABLE desks
  ADD COLUMN IF NOT EXISTS share_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

