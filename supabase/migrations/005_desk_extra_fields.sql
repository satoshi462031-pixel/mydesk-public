-- =============================================================
-- 005_desk_extra_fields.sql — purposes / owner_name
-- =============================================================

ALTER TABLE desks
  ADD COLUMN IF NOT EXISTS purposes     TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS owner_name   TEXT    NOT NULL DEFAULT '';
