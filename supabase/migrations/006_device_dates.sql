-- =============================================================
-- 006_device_dates.sql — devices に導入日 / 撤去日を追加
-- 共有デスクの詳細ページでも「デスクの歴史」を再生できるようにする。
-- どちらも任意。未設定の機器は created_at を導入日とみなす（アプリ側の挙動）。
-- =============================================================

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS purchased_at DATE,
  ADD COLUMN IF NOT EXISTS removed_at   DATE;
