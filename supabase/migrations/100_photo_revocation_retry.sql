-- Storage削除とDB更新は同一トランザクションにできないため、未失効URLを再試行用に残す。
ALTER TABLE public.desk_photos
  ADD COLUMN IF NOT EXISTS pending_revocation_url TEXT;

CREATE OR REPLACE FUNCTION public.queue_desk_photo_revocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.visibility = 'private' AND OLD.visibility <> 'private' THEN
    UPDATE public.desk_photos
    SET pending_revocation_url = COALESCE(pending_revocation_url, image_url)
    WHERE desk_id = NEW.id;
  ELSIF NEW.visibility <> 'private' AND EXISTS (
    SELECT 1 FROM public.desk_photos
    WHERE desk_id = NEW.id AND pending_revocation_url IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PHOTO_REVOCATION_INCOMPLETE';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_desk_photo_revocation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS desks_queue_photo_revocation ON public.desks;
CREATE TRIGGER desks_queue_photo_revocation
  BEFORE UPDATE OF visibility ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.queue_desk_photo_revocation();

NOTIFY pgrst, 'reload schema';
