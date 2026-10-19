-- =============================================================
-- MyDesk — Supabase Schema + RLS + Storage
-- Supabase Dashboard の SQL Editor にそのまま貼り付けて実行
-- =============================================================

-- ─── 拡張機能 ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- TABLES
-- =============================================================

-- ─── profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE,
  public_tag    TEXT UNIQUE NOT NULL CHECK (public_tag ~ '^[0-9A-F]{6}$'),
  display_name  TEXT,
  avatar_url    TEXT,
  bio           TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── desks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS desks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'MyDesk',
  description TEXT,
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  total_price INTEGER DEFAULT 0,
  owner_tag   TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── desk_photos ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS desk_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id     UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── devices ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id     UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  brand       TEXT,
  category    TEXT NOT NULL,
  price       INTEGER,
  ports       JSONB DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── connections ─────────────────────────────────────────────
-- 配線図は JSON で保存。将来の SVG/PNG 出力・フォークに対応する構造。
CREATE TABLE IF NOT EXISTS connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id        UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  from_device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  to_device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  cable_type     TEXT NOT NULL,
  label          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ─── desk_versions ───────────────────────────────────────────
-- スナップショット: devices + connections の JSON を丸ごと保存
CREATE TABLE IF NOT EXISTS desk_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  desk_id      UUID NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
  version_name TEXT NOT NULL,
  snapshot     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- =============================================================
-- INDEXES
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_desks_user_id      ON desks(user_id);
CREATE INDEX IF NOT EXISTS idx_desks_visibility   ON desks(visibility);
CREATE INDEX IF NOT EXISTS idx_desk_photos_desk   ON desk_photos(desk_id);
CREATE INDEX IF NOT EXISTS idx_devices_desk       ON devices(desk_id);
CREATE INDEX IF NOT EXISTS idx_connections_desk   ON connections(desk_id);
CREATE INDEX IF NOT EXISTS idx_desk_versions_desk ON desk_versions(desk_id);

-- =============================================================
-- AUTO-UPDATE updated_at
-- =============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER desks_updated_at
  BEFORE UPDATE ON desks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================
-- AUTO-CREATE profile on signup
-- =============================================================
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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE public_tag = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

-- display_name にメールアドレスを入れないこと。この値は公開時に
-- desks.owner_name へコピーされ、公開デスクは誰でも読める（024参照）。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  LOOP
    BEGIN
      INSERT INTO public.profiles (id, username, public_tag, display_name, avatar_url)
      VALUES (
        NEW.id,
        'user_' || replace(NEW.id::TEXT, '-', ''),
        public.generate_public_tag(),
        COALESCE(
          NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
          NULLIF(BTRIM(NEW.raw_user_meta_data->>'name'), '')
        ),
        NEW.raw_user_meta_data->>'avatar_url'
      );
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT public_tag INTO NEW.owner_tag FROM public.profiles WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER desks_set_owner_tag
  BEFORE INSERT OR UPDATE OF user_id, owner_tag ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.set_desk_owner_tag();

CREATE OR REPLACE FUNCTION public.prevent_public_tag_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_tag IS DISTINCT FROM OLD.public_tag THEN
    RAISE EXCEPTION 'public_tag cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_public_tag_immutable
  BEFORE UPDATE OF public_tag ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_public_tag_change();

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE desks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_photos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE desk_versions ENABLE ROW LEVEL SECURITY;

-- ─── profiles ────────────────────────────────────────────────
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ─── desks ───────────────────────────────────────────────────
-- 公開デスクは誰でも読める
CREATE POLICY "desks_select_public"
  ON desks FOR SELECT
  USING (visibility = 'public' OR auth.uid() = user_id);

CREATE POLICY "desks_insert_own"
  ON desks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "desks_update_own"
  ON desks FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "desks_delete_own"
  ON desks FOR DELETE
  USING (auth.uid() = user_id);

-- ─── desk_photos ─────────────────────────────────────────────
CREATE POLICY "desk_photos_select"
  ON desk_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM desks d
      WHERE d.id = desk_id
        AND (d.visibility = 'public' OR d.user_id = auth.uid())
    )
  );

CREATE POLICY "desk_photos_insert_own"
  ON desk_photos FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

-- 公開取り消し時に写真のパスを振り直す（旧URLを失効させる）ために必要。027参照
CREATE POLICY "desk_photos_update_own"
  ON desk_photos FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

CREATE POLICY "desk_photos_delete_own"
  ON desk_photos FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

-- ─── devices ─────────────────────────────────────────────────
CREATE POLICY "devices_select"
  ON devices FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM desks d
      WHERE d.id = desk_id
        AND (d.visibility = 'public' OR d.user_id = auth.uid())
    )
  );

CREATE POLICY "devices_insert_own"
  ON devices FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

CREATE POLICY "devices_update_own"
  ON devices FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

CREATE POLICY "devices_delete_own"
  ON devices FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

-- ─── connections ─────────────────────────────────────────────
CREATE POLICY "connections_select"
  ON connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM desks d
      WHERE d.id = desk_id
        AND (d.visibility = 'public' OR d.user_id = auth.uid())
    )
  );

CREATE POLICY "connections_insert_own"
  ON connections FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

CREATE POLICY "connections_delete_own"
  ON connections FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

-- ─── desk_versions ───────────────────────────────────────────
CREATE POLICY "desk_versions_select"
  ON desk_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM desks d
      WHERE d.id = desk_id
        AND (d.visibility = 'public' OR d.user_id = auth.uid())
    )
  );

CREATE POLICY "desk_versions_insert_own"
  ON desk_versions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

CREATE POLICY "desk_versions_delete_own"
  ON desk_versions FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM desks d WHERE d.id = desk_id AND d.user_id = auth.uid())
  );

-- =============================================================
-- STORAGE — desk-images バケット
-- =============================================================
-- Supabase Dashboard > Storage > New Bucket で作成してもよいが、
-- SQL で実行する場合は以下を使用:

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'desk-images',
  'desk-images',
  true,
  10485760,  -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
-- SELECT を anon にも開くと、バンドルから取り出した anon キーで list API を叩き
-- 全ユーザーのフォルダを列挙できる。公開ページの写真は RLS を通らない
-- /object/public/ 経由なので、所有者限定にしても表示は壊れない（024参照）。
CREATE POLICY "desk_images_owner_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- auth.role() は非推奨（環境によって NULL を返し INSERT が RLS で弾かれる）ため、
-- TO authenticated + auth.uid() の一致で判定する。
CREATE POLICY "desk_images_auth_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "desk_images_own_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "desk_images_own_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'desk-images'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
