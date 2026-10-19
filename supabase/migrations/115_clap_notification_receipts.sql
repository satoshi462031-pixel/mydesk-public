CREATE TABLE account_security.clap_receipts (
  desk_id UUID NOT NULL REFERENCES public.desks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  round_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  PRIMARY KEY (desk_id, user_id, round_at)
);
CREATE INDEX clap_receipts_pending_idx ON account_security.clap_receipts(desk_id, received_at) WHERE notified_at IS NULL;
ALTER TABLE account_security.clap_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_security.clap_receipts FROM PUBLIC, anon, authenticated;
-- 既存の未来日時や過去の拍手を、導入後の新規通知にしない。
INSERT INTO account_security.clap_receipts(desk_id, user_id, round_at, received_at, notified_at)
SELECT desk_id, user_id, round_at, LEAST(created_at, now()), now() FROM public.likes;
UPDATE public.likes SET created_at = now() WHERE created_at > now();

CREATE FUNCTION public.guard_clap_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.created_at := COALESCE((SELECT received_at FROM account_security.clap_receipts
    WHERE desk_id = NEW.desk_id AND user_id = NEW.user_id AND round_at = NEW.round_at), statement_timestamp());
  RETURN NEW;
END;
$$;
-- likes_set_roundが確定した版を使うため、その後に走る名前にする。
CREATE TRIGGER likes_set_round_timestamp BEFORE INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.guard_clap_timestamp();
CREATE FUNCTION public.record_clap_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO account_security.clap_receipts(desk_id, user_id, round_at, received_at)
  VALUES (NEW.desk_id, NEW.user_id, NEW.round_at, statement_timestamp()) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER likes_record_receipt AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.record_clap_receipt();
REVOKE ALL ON FUNCTION public.guard_clap_timestamp(), public.record_clap_receipt() FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.likes FROM authenticated;

CREATE FUNCTION public.claim_desk_clap_notification(p_desk_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_desk RECORD;
  v_now TIMESTAMPTZ := statement_timestamp();
  v_last TIMESTAMPTZ;
  v_fresh INTEGER;
BEGIN
  SELECT id, user_id, title INTO v_desk FROM public.desks WHERE id = p_desk_id AND visibility = 'public';
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('clap_push:' || v_desk.user_id::TEXT, 0)) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.notification_prefs WHERE user_id = v_desk.user_id AND claps = false) THEN RETURN NULL; END IF;
  SELECT last_sent_at INTO v_last FROM public.clap_push_log WHERE user_id = v_desk.user_id;
  IF v_last > v_now - INTERVAL '12 hours' THEN RETURN NULL; END IF;
  WITH claimed AS (
    UPDATE account_security.clap_receipts r SET notified_at = v_now
    WHERE r.desk_id = p_desk_id AND r.notified_at IS NULL
      AND r.received_at BETWEEN v_now - INTERVAL '24 hours' AND v_now
      AND r.user_id <> v_desk.user_id
      AND EXISTS (SELECT 1 FROM public.likes l WHERE l.desk_id = r.desk_id AND l.user_id = r.user_id AND l.round_at = r.round_at)
      AND NOT EXISTS (SELECT 1 FROM public.blocked_users b WHERE
        (b.blocker_id = v_desk.user_id AND b.blocked_id = r.user_id) OR
        (b.blocked_id = v_desk.user_id AND b.blocker_id = r.user_id))
    RETURNING 1
  ) SELECT count(*) INTO v_fresh FROM claimed;
  IF v_fresh = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.clap_push_log(user_id, last_sent_at) VALUES (v_desk.user_id, v_now)
    ON CONFLICT (user_id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at;
  RETURN jsonb_build_object('desk', jsonb_build_object('id', v_desk.id, 'user_id', v_desk.user_id,
    'title', v_desk.title), 'fresh', v_fresh);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_desk_clap_notification(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_desk_clap_notification(UUID) TO service_role;
NOTIFY pgrst, 'reload schema';
