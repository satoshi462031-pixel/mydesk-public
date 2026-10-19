-- AI回答をアプリ内から報告するための保存先。
CREATE TABLE IF NOT EXISTS public.ai_response_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL CHECK (reason IN ('unsafe', 'inaccurate')),
  response_text   TEXT NOT NULL CHECK (char_length(response_text) BETWEEN 1 AND 8000),
  prompt_text     TEXT CHECK (prompt_text IS NULL OR char_length(prompt_text) <= 2000),
  conversation_id TEXT NOT NULL CHECK (char_length(conversation_id) BETWEEN 1 AND 100),
  message_id      TEXT NOT NULL CHECK (char_length(message_id) BETWEEN 1 AND 100),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  UNIQUE (reporter_id, conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS ai_response_reports_status_created_idx
  ON public.ai_response_reports (status, created_at DESC);

ALTER TABLE public.ai_response_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_response_reports_insert_own ON public.ai_response_reports;
CREATE POLICY ai_response_reports_insert_own
  ON public.ai_response_reports FOR INSERT
  TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND status = 'open' AND reviewed_at IS NULL);

DROP POLICY IF EXISTS ai_response_reports_select_own ON public.ai_response_reports;
CREATE POLICY ai_response_reports_select_own
  ON public.ai_response_reports FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

GRANT INSERT, SELECT ON public.ai_response_reports TO authenticated;

NOTIFY pgrst, 'reload schema';

