CREATE TABLE account_security.photo_revocation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID,
  desk_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  old_url TEXT NOT NULL UNIQUE,
  new_url TEXT NOT NULL,
  preserve_photo BOOLEAN NOT NULL DEFAULT true,
  committed BOOLEAN NOT NULL DEFAULT false,
  target_used BOOLEAN NOT NULL DEFAULT false,
  lease_token UUID,
  leased_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON account_security.photo_revocation_jobs FROM PUBLIC, anon, authenticated;
ALTER TABLE account_security.photo_revocation_jobs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA account_security TO service_role;
CREATE INDEX photo_revocation_jobs_photo_idx ON account_security.photo_revocation_jobs(photo_id) WHERE NOT committed;

-- URL の形が本人のフォルダでも、Storage に無い画像は失効させるものが無い。
-- 架空の URL を書くだけでジョブ（service_role の Storage 操作）を増やせないよう、受理済みの実体があるものだけを積む
CREATE FUNCTION account_security.stored_desk_image_exists(p_url TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'desk-images'
    AND name = substring(p_url FROM '/storage/v1/object/public/desk-images/(.+)$'));
$$;
REVOKE ALL ON FUNCTION account_security.stored_desk_image_exists(TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION account_security.enqueue_photo_revocation(
  p_photo_id UUID, p_desk_id UUID, p_owner_id UUID, p_url TEXT, p_preserve BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_url IS NULL OR NOT public.is_own_public_image_url(p_url, p_owner_id, p_desk_id::text)
    OR NOT account_security.stored_desk_image_exists(p_url) THEN RETURN; END IF;
  INSERT INTO account_security.photo_revocation_jobs (photo_id, desk_id, owner_id, old_url, new_url, preserve_photo)
  VALUES (p_photo_id, p_desk_id, p_owner_id, p_url,
    regexp_replace(p_url, '[^/]+$', gen_random_uuid()::text || '.jpg'), p_preserve)
  ON CONFLICT (old_url) DO UPDATE SET
    preserve_photo = account_security.photo_revocation_jobs.preserve_photo AND EXCLUDED.preserve_photo;
END;
$$;
REVOKE ALL ON FUNCTION account_security.enqueue_photo_revocation(UUID, UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- 印（pending_revocation_url）は所有者が書ける。正しい書き手（端末の差し替え・100 の非公開化・101 の再発行）は
-- どれも「その写真の今の image_url」か NULL を書くので、それ以外の URL は拒む。任意の URL を書いてジョブを作らせない
CREATE FUNCTION public.guard_pending_revocation_url()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.pending_revocation_url IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.pending_revocation_url IS DISTINCT FROM NEW.image_url THEN
      RAISE EXCEPTION 'PHOTO_REVOCATION_MARKER_INVALID' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.pending_revocation_url IS DISTINCT FROM OLD.pending_revocation_url
    AND NEW.pending_revocation_url IS DISTINCT FROM OLD.image_url THEN
    RAISE EXCEPTION 'PHOTO_REVOCATION_MARKER_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_pending_revocation_url() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER desk_photos_guard_revocation_marker
  BEFORE INSERT OR UPDATE OF pending_revocation_url ON public.desk_photos
  FOR EACH ROW EXECUTE FUNCTION public.guard_pending_revocation_url();

CREATE FUNCTION public.enqueue_pending_photo_revocation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner UUID;
BEGIN
  IF NEW.pending_revocation_url IS NOT NULL AND
    (TG_OP = 'INSERT' OR OLD.pending_revocation_url IS DISTINCT FROM NEW.pending_revocation_url) THEN
    -- 端末も自分で差し替えを続けるので、印からのジョブは取りこぼしの保険。写真1枚あたりの未処理を絞り、
    -- 実体のある画像を差し替え続けてもキューが伸びないようにする（非公開化・再発行・削除の経路は絞らない）
    IF (SELECT count(*) FROM account_security.photo_revocation_jobs
        WHERE photo_id = NEW.id AND NOT committed) >= 2 THEN RETURN NEW; END IF;
    SELECT user_id INTO v_owner FROM public.desks WHERE id = NEW.desk_id;
    PERFORM account_security.enqueue_photo_revocation(NEW.id, NEW.desk_id, v_owner, NEW.pending_revocation_url, true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_pending_photo_revocation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER desk_photos_enqueue_revocation
  AFTER INSERT OR UPDATE OF pending_revocation_url ON public.desk_photos
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_pending_photo_revocation();

-- 非公開化（100）は印を立てるだけなので、印の経路の上限に掛からないよう、ここで直接積む
CREATE FUNCTION public.enqueue_private_desk_photos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p RECORD;
BEGIN
  IF NEW.visibility = 'private' AND OLD.visibility IS DISTINCT FROM 'private' THEN
    FOR p IN SELECT id, image_url, pending_revocation_url FROM public.desk_photos WHERE desk_id = NEW.id LOOP
      PERFORM account_security.enqueue_photo_revocation(p.id, NEW.id, NEW.user_id, p.image_url, true);
      PERFORM account_security.enqueue_photo_revocation(p.id, NEW.id, NEW.user_id, p.pending_revocation_url, true);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_private_desk_photos() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER desks_enqueue_private_photos AFTER UPDATE OF visibility ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_private_desk_photos();

CREATE FUNCTION public.enqueue_deleted_desk_photos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT * FROM public.desk_photos WHERE desk_id = OLD.id LOOP
    PERFORM account_security.enqueue_photo_revocation(p.id, OLD.id, OLD.user_id, p.image_url, false);
    PERFORM account_security.enqueue_photo_revocation(p.id, OLD.id, OLD.user_id, p.pending_revocation_url, false);
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_deleted_desk_photos() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER desks_enqueue_deleted_photos BEFORE DELETE ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_deleted_desk_photos();

CREATE FUNCTION public.enqueue_reissued_link_photos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p RECORD; v_owner UUID;
BEGIN
  IF OLD.token IS DISTINCT FROM NEW.token THEN
    SELECT user_id INTO v_owner FROM public.desks WHERE id = NEW.desk_id;
    -- 端末同期用の旧URLが残っていても、今回まで有効だった画像を必ず失効させる。
    FOR p IN SELECT id, image_url FROM public.desk_photos WHERE desk_id = NEW.desk_id LOOP
      PERFORM account_security.enqueue_photo_revocation(p.id, NEW.desk_id, v_owner, p.image_url, true);
    END LOOP;
    UPDATE public.desk_photos SET pending_revocation_url = COALESCE(pending_revocation_url, image_url)
    WHERE desk_id = NEW.desk_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_reissued_link_photos() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER unlisted_links_enqueue_photos AFTER UPDATE OF token ON public.unlisted_desk_links
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_reissued_link_photos();

CREATE FUNCTION public.claim_photo_revocations(p_limit INTEGER DEFAULT 10)
RETURNS SETOF account_security.photo_revocation_jobs
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  -- 失敗したジョブはリースが切れてから取り直すので、リースを試行ごとに倍にして再試行の間隔にする（上限6時間）。
  -- 取り出しは所有者ごとに1件ずつ順に回し、ジョブの多い人が他の人の失効を後回しにしないようにする
  UPDATE account_security.photo_revocation_jobs j
  SET lease_token = gen_random_uuid(),
    leased_until = now() + least(interval '5 minutes' * power(2, least(j.attempts, 7)), interval '6 hours'),
    attempts = j.attempts + 1
  WHERE j.id IN (
    SELECT id FROM account_security.photo_revocation_jobs
    WHERE id IN (
      SELECT id FROM (
        SELECT id, attempts, created_at,
          row_number() OVER (PARTITION BY owner_id ORDER BY attempts, created_at) AS turn
        FROM account_security.photo_revocation_jobs
        WHERE leased_until IS NULL OR leased_until < now()
      ) ranked
      ORDER BY turn, attempts, created_at LIMIT greatest(1, least(p_limit, 10))
    ) FOR UPDATE SKIP LOCKED
  ) RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.claim_photo_revocations(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_photo_revocations(INTEGER) TO service_role;

CREATE FUNCTION account_security.replace_photo_urls(p_value JSONB, p_old TEXT, p_new TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_result JSONB;
BEGIN
  IF jsonb_typeof(p_value) = 'string' THEN
    IF p_value #>> '{}' = p_old THEN RETURN to_jsonb(p_new); END IF;
    IF p_value #>> '{}' = regexp_replace(p_old, '\.jpg$', '_thumb.jpg') THEN RETURN to_jsonb(regexp_replace(p_new, '\.jpg$', '_thumb.jpg')); END IF;
    IF p_value #>> '{}' = regexp_replace(p_old, '\.jpg$', '_md.jpg') THEN RETURN to_jsonb(regexp_replace(p_new, '\.jpg$', '_md.jpg')); END IF;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(account_security.replace_photo_urls(value, p_old, p_new) ORDER BY ord), '[]'::jsonb)
    INTO v_result FROM jsonb_array_elements(p_value) WITH ORDINALITY AS e(value, ord);
    RETURN v_result;
  ELSIF jsonb_typeof(p_value) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(key, account_security.replace_photo_urls(value, p_old, p_new)), '{}'::jsonb)
    INTO v_result FROM jsonb_each(p_value);
    RETURN v_result;
  END IF;
  RETURN p_value;
END;
$$;
REVOKE ALL ON FUNCTION account_security.replace_photo_urls(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.commit_photo_revocation(p_job_id UUID, p_lease_token UUID, p_copy_ready BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j account_security.photo_revocation_jobs; v_image TEXT;
BEGIN
  SELECT * INTO j FROM account_security.photo_revocation_jobs
  WHERE id = p_job_id AND lease_token = p_lease_token AND leased_until > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVOCATION_LEASE_LOST'; END IF;
  IF j.committed THEN RETURN j.target_used; END IF;
  -- 公開範囲の変更・端末側の写真差し替えと直列化する。
  PERFORM 1 FROM public.desks WHERE id = j.desk_id FOR UPDATE;
  SELECT image_url INTO v_image FROM public.desk_photos WHERE id = j.photo_id FOR UPDATE;
  IF j.preserve_photo AND v_image = j.old_url THEN
    IF p_copy_ready IS NOT TRUE THEN RAISE EXCEPTION 'REVOCATION_COPY_NOT_READY'; END IF;
    UPDATE public.desk_photos SET image_url = j.new_url WHERE id = j.photo_id;
    UPDATE public.desks SET share_snapshot = account_security.replace_photo_urls(share_snapshot, j.old_url, j.new_url)
    WHERE id = j.desk_id;
    v_image := j.new_url;
  END IF;
  UPDATE account_security.photo_revocation_jobs SET committed = true, target_used = (v_image = j.new_url) IS TRUE
  WHERE id = j.id;
  RETURN (v_image = j.new_url) IS TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_photo_revocation(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_photo_revocation(UUID, UUID, BOOLEAN) TO service_role;

CREATE FUNCTION public.finish_photo_revocation(p_job_id UUID, p_lease_token UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM account_security.photo_revocation_jobs
  WHERE id = p_job_id AND lease_token = p_lease_token AND committed;
$$;
REVOKE ALL ON FUNCTION public.finish_photo_revocation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_photo_revocation(UUID, UUID) TO service_role;

INSERT INTO account_security.photo_revocation_jobs (photo_id, desk_id, owner_id, old_url, new_url)
SELECT p.id, p.desk_id, d.user_id, p.pending_revocation_url,
  regexp_replace(p.pending_revocation_url, '[^/]+$', gen_random_uuid()::text || '.jpg')
FROM public.desk_photos p JOIN public.desks d ON d.id = p.desk_id
WHERE p.pending_revocation_url IS NOT NULL
  AND public.is_own_public_image_url(p.pending_revocation_url, d.user_id, d.id::text)
  AND account_security.stored_desk_image_exists(p.pending_revocation_url)
ON CONFLICT (old_url) DO NOTHING;
NOTIFY pgrst, 'reload schema';
