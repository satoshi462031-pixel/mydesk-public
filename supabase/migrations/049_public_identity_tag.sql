-- 公開ニックネームは重複を許し、公開タグで投稿者を一意に識別する。
-- タグはメール・ユーザーUUID・OAuth名から作らず、公開デスクへ必要な値だけコピーする。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS public_tag TEXT;

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS owner_tag TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS profiles_public_tag_key
  ON public.profiles (public_tag)
  WHERE public_tag IS NOT NULL;

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
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE public_tag = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

DROP TRIGGER IF EXISTS profiles_public_tag_immutable ON public.profiles;

-- 既存ユーザーを1行ずつ補完する。同時実行の衝突も一意制約で検出して再生成する。
DO $$
DECLARE
  profile_row RECORD;
BEGIN
  FOR profile_row IN
    SELECT id
    FROM public.profiles
    WHERE public_tag IS NULL OR public_tag !~ '^[0-9A-F]{6}$'
  LOOP
    LOOP
      BEGIN
        UPDATE public.profiles
        SET public_tag = public.generate_public_tag()
        WHERE id = profile_row.id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN public_tag SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_public_tag_format'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_public_tag_format
      CHECK (public_tag ~ '^[0-9A-F]{6}$');
  END IF;
END;
$$;

-- タグは作成後に変更できない。表示名だけを自由に変更できる設計にする。
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

DROP TRIGGER IF EXISTS profiles_public_tag_immutable ON public.profiles;
CREATE TRIGGER profiles_public_tag_immutable
  BEFORE UPDATE OF public_tag ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_public_tag_change();

-- 新規登録は一意制約違反を捕捉して再生成する。確率任せで衝突を通さない。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      -- NEW.id と username は新規UUID由来なので、競合し得るのは public_tag だけ。
      NULL;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;

-- クライアントが owner_tag を偽装しても、デスク所有者の確定済みタグで上書きする。
CREATE OR REPLACE FUNCTION public.set_desk_owner_tag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT public_tag INTO NEW.owner_tag
  FROM public.profiles
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

-- 既存デスクの並び順を変えずにタグを補完する。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.desks'::regclass
      AND tgname = 'desks_updated_at'
  ) THEN
    ALTER TABLE public.desks DISABLE TRIGGER desks_updated_at;
  END IF;
END;
$$;

UPDATE public.desks AS d
SET owner_tag = p.public_tag
FROM public.profiles AS p
WHERE d.user_id = p.id
  AND d.owner_tag IS DISTINCT FROM p.public_tag;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.desks'::regclass
      AND tgname = 'desks_updated_at'
  ) THEN
    ALTER TABLE public.desks ENABLE TRIGGER desks_updated_at;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS desks_set_owner_tag ON public.desks;
CREATE TRIGGER desks_set_owner_tag
  BEFORE INSERT OR UPDATE OF user_id, owner_tag ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.set_desk_owner_tag();

REVOKE ALL ON FUNCTION public.generate_public_tag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_public_tag_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_desk_owner_tag() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
