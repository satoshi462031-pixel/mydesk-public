CREATE INDEX desk_reports_pending_case_idx ON public.desk_reports(desk_id, created_at)
  WHERE status IN ('open', 'reviewing');

CREATE FUNCTION public.admin_desk_report_cases(p_limit INTEGER DEFAULT 100)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH cases AS (
    SELECT r.desk_id, max(r.desk_title) AS desk_title, min(r.created_at) AS first_report_at,
      max(r.created_at) AS last_report_at, count(*) AS pending_count,
      count(*) FILTER (WHERE r.status = 'reviewing') AS reviewing_count,
      count(*) FILTER (WHERE r.created_at > now() - INTERVAL '1 hour') AS last_hour_count,
      count(*) FILTER (WHERE u.created_at > r.created_at - INTERVAL '1 day') AS new_account_count
    FROM public.desk_reports r LEFT JOIN auth.users u ON u.id = r.reporter_id
    WHERE r.status IN ('open', 'reviewing') GROUP BY r.desk_id
    ORDER BY min(r.created_at), r.desk_id LIMIT LEAST(200, GREATEST(1, COALESCE(p_limit, 100)))
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(c) || jsonb_build_object(
    'burst_detected', c.last_hour_count >= 10,
    'reasons', (SELECT jsonb_object_agg(reason, amount) FROM (
      SELECT reason, count(*) AS amount FROM public.desk_reports
      WHERE desk_id = c.desk_id AND status IN ('open', 'reviewing') GROUP BY reason
    ) reasons)
  ) ORDER BY c.first_report_at, c.desk_id), '[]'::jsonb) FROM cases c;
$$;

-- 一覧を見た後に届いた通報は処理しない。件数による公開停止は行わない。
CREATE FUNCTION public.resolve_desk_report_case(p_desk_id UUID, p_status TEXT, p_before TIMESTAMPTZ, p_note TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('reviewing', 'resolved', 'dismissed')
    OR p_before IS NULL OR p_before > statement_timestamp() OR char_length(p_note) > 2000 THEN
    RAISE EXCEPTION 'INVALID_REPORT_RESOLUTION' USING ERRCODE = '22023';
  END IF;
  UPDATE public.desk_reports SET status = p_status, reviewed_at = statement_timestamp(), resolution_note = p_note
  WHERE desk_id = p_desk_id AND status IN ('open', 'reviewing') AND created_at <= p_before;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_desk_report_cases(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_desk_report_case(UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_desk_report_cases(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_desk_report_case(UUID, TEXT, TIMESTAMPTZ, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
