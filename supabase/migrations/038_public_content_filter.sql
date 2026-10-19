-- クライアントを迂回した直接更新でも、明白な禁止テキストを公開させない。
CREATE OR REPLACE FUNCTION public.validate_public_desk_content()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_identity TEXT := coalesce(NEW.title, '') || E'\n' || coalesce(NEW.owner_name, '');
  v_content  TEXT := lower(v_identity || E'\n' || coalesce(NEW.description, '') || E'\n' || coalesce(NEW.share_snapshot::text, ''));
BEGIN
  IF NEW.visibility <> 'public' THEN
    RETURN NEW;
  END IF;

  IF v_identity ~* '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'public identity contains an email address' USING ERRCODE = '23514';
  END IF;

  IF v_content ~ '(児童ポルノ|児童性的|性的搾取|殺害予告|自殺方法|child[[:space:]]*(porn|sexual)|sexual[[:space:]]*exploitation|kill[[:space:]]+yourself)' THEN
    RAISE EXCEPTION 'public content is prohibited' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_public_desk_content ON public.desks;
CREATE TRIGGER trg_validate_public_desk_content
  BEFORE INSERT OR UPDATE OF title, description, owner_name, share_snapshot, visibility
  ON public.desks
  FOR EACH ROW EXECUTE FUNCTION public.validate_public_desk_content();

