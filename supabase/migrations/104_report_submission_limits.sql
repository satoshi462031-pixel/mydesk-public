-- アプリ以外からの直接送信にも適用する。既存レコードや運営の処理は変更しない。
CREATE INDEX feedback_user_created_idx ON public.feedback (user_id, created_at DESC);
CREATE INDEX ai_response_reports_reporter_created_idx ON public.ai_response_reports (reporter_id, created_at DESC);
CREATE INDEX desk_reports_reporter_created_idx ON public.desk_reports (reporter_id, created_at DESC);

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_app_version_size CHECK (app_version IS NULL OR char_length(app_version) <= 100) NOT VALID,
  ADD CONSTRAINT feedback_platform_size CHECK (platform IS NULL OR char_length(platform) <= 30) NOT VALID;

CREATE FUNCTION public.guard_report_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user_column TEXT;
  v_hour_limit INTEGER;
  v_day_limit INTEGER;
  v_hour_count INTEGER;
  v_day_count INTEGER;
  v_now TIMESTAMPTZ := statement_timestamp();
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME NOT IN ('feedback', 'desk_reports', 'ai_response_reports') THEN
    RAISE EXCEPTION 'INVALID_REPORT_TABLE' USING ERRCODE = '42501';
  END IF;
  v_user_column := CASE WHEN TG_TABLE_NAME = 'feedback' THEN 'user_id' ELSE 'reporter_id' END;
  IF v_uid IS NULL OR (to_jsonb(NEW)->>v_user_column) IS DISTINCT FROM v_uid::TEXT THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  NEW.created_at := v_now;
  -- 保存済みの通報の再送は従来の UNIQUE 制約へ渡し、応答喪失後も通報済みと判定できるようにする。
  IF TG_TABLE_NAME = 'desk_reports' THEN
    IF EXISTS (SELECT 1 FROM public.desk_reports WHERE reporter_id = v_uid AND desk_id = NEW.desk_id) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_response_reports' THEN
    IF EXISTS (SELECT 1 FROM public.ai_response_reports
      WHERE reporter_id = v_uid AND conversation_id = NEW.conversation_id AND message_id = NEW.message_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 同時送信を待ち行列にせず拒否する。別のアカウントには影響させない。
  IF NOT pg_try_advisory_xact_lock(hashtextextended('report:' || TG_TABLE_NAME || ':' || v_uid::TEXT, 0)) THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;
  v_hour_limit := CASE WHEN TG_TABLE_NAME = 'feedback' THEN 5 ELSE 10 END;
  v_day_limit := CASE WHEN TG_TABLE_NAME = 'feedback' THEN 20 ELSE 50 END;

  EXECUTE format(
    'SELECT count(*) FILTER (WHERE created_at >= $2 - interval ''1 hour''), count(*) ' ||
    'FROM (SELECT created_at FROM public.%I WHERE %I = $1 ' ||
    'AND created_at >= $2 - interval ''1 day'' ORDER BY created_at DESC LIMIT $3) recent',
    TG_TABLE_NAME, v_user_column
  ) INTO v_hour_count, v_day_count USING v_uid, v_now, v_day_limit;

  IF v_hour_count >= v_hour_limit OR v_day_count >= v_day_limit THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMITED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_report_submission() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_report_submission
  BEFORE INSERT ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_submission();
CREATE TRIGGER guard_report_submission
  BEFORE INSERT ON public.desk_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_submission();
CREATE TRIGGER guard_report_submission
  BEFORE INSERT ON public.ai_response_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_report_submission();

NOTIFY pgrst, 'reload schema';
