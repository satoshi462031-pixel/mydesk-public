-- schema.sql の desk_versions がリモート未適用だったため、
-- 002 以降が前提とするベースラインをここで補完する（冪等）
CREATE TABLE IF NOT EXISTS desk_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id      UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  version_name TEXT NOT NULL,
  snapshot     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desk_versions_desk ON desk_versions(desk_id);

ALTER TABLE desk_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "desk_versions_select" ON desk_versions;
CREATE POLICY "desk_versions_select"
  ON desk_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM desks d
      WHERE d.id = desk_id
        AND (d.visibility = 'public' OR d.user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "desk_versions_insert_own" ON desk_versions;
CREATE POLICY "desk_versions_insert_own"
  ON desk_versions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "desk_versions_delete_own" ON desk_versions;
CREATE POLICY "desk_versions_delete_own"
  ON desk_versions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );
