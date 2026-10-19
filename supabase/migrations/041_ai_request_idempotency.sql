-- AIリクエストの通信切断・再送で、利用枠と上流API原価を二重消費しないための冪等記録。
CREATE TABLE IF NOT EXISTS public.ai_requests (
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id    UUID NOT NULL,
  status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  response_text TEXT,
  usage         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);

ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_requests TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ai_request(p_user_id UUID, p_request_id UUID)
RETURNS TABLE(state TEXT, response_text TEXT, usage JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INTEGER;
  v_row public.ai_requests%ROWTYPE;
BEGIN
  DELETE FROM public.ai_requests
  WHERE user_id = p_user_id AND created_at < now() - interval '30 days';

  INSERT INTO public.ai_requests (user_id, request_id)
  VALUES (p_user_id, p_request_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN QUERY SELECT 'claimed'::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.ai_requests
  WHERE user_id = p_user_id AND request_id = p_request_id
  FOR UPDATE;

  IF v_row.status = 'completed' THEN
    RETURN QUERY SELECT 'completed'::TEXT, v_row.response_text, v_row.usage;
    RETURN;
  END IF;
  IF v_row.status = 'processing' AND v_row.updated_at > now() - interval '2 minutes' THEN
    RETURN QUERY SELECT 'processing'::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE public.ai_requests
  SET status = 'processing', response_text = NULL, usage = NULL, updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id;
  RETURN QUERY SELECT 'claimed'::TEXT, NULL::TEXT, NULL::JSONB;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_ai_request(
  p_user_id UUID,
  p_request_id UUID,
  p_response_text TEXT,
  p_usage JSONB
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ai_requests
  SET status = 'completed', response_text = p_response_text, usage = p_usage, updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id;
$$;

CREATE OR REPLACE FUNCTION public.fail_ai_request(p_user_id UUID, p_request_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ai_requests
  SET status = 'failed', updated_at = now()
  WHERE user_id = p_user_id AND request_id = p_request_id;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_request(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_ai_request(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_ai_request(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_request(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_ai_request(UUID, UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_ai_request(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
