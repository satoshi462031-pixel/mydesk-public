-- 匿名フィードバックのDB直書きを止める。ログイン不能時の連絡先は
-- プライバシーポリシー記載のメール窓口を使う。
DROP POLICY IF EXISTS "feedback_insert" ON public.feedback;
CREATE POLICY "feedback_insert"
  ON public.feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

REVOKE INSERT ON public.feedback FROM anon;
GRANT INSERT ON public.feedback TO authenticated;

-- authenticatedから任意UUIDの契約状態を照会できないようにする。
-- RLSは本人のUUID、AIのservice_role RPCは対象ユーザーのUUIDを渡すため、
-- 既存の内部利用は維持できる。
CREATE OR REPLACE FUNCTION public.is_pro_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.subscriptions s ON s.user_id = p.id
    WHERE p.id = p_user_id
      AND p.tier = 'pro'
      AND (
        s.user_id IS NULL
        OR s.expires_at IS NULL
        OR s.expires_at > now() - interval '3 days'
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_pro_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_pro_user(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
