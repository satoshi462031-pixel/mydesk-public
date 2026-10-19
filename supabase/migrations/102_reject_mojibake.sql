-- UTF-8 を1バイト1文字で読んで化けた文字列（TestFlight 1.0.0 (24) の timeoutFetch）を、
-- 端末がそのまま書き戻して保存されるのを止める。化けた版のアプリは手元に残り続けるので、アプリ側の修正だけでは防げない。
-- 化けると UTF-8 の2バイト目以降が U+0080〜U+009F（C1 制御文字）になり、日本語ではほぼ必ず混ざる。
-- 人が入力する文字列にはまず現れないので、これを含む値を拒否する。
-- UPDATE では変わった列だけを見る。既に化けた行の、無関係な列の更新（拍手数など）まで止めないため。
CREATE FUNCTION public.reject_mojibake()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  new_row JSONB := to_jsonb(NEW);
  old_row JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  col TEXT;
BEGIN
  FOR col IN
    SELECT n.key FROM jsonb_each(new_row) AS n
    WHERE n.value IS DISTINCT FROM old_row -> n.key
      AND n.value::text ~ '[\u0080-\u009F]'
  LOOP
    RAISE EXCEPTION 'mojibake_detected: %.%', TG_TABLE_NAME, col
      USING ERRCODE = '22021', HINT = 'The text was decoded with the wrong encoding before being saved.';
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_mojibake() FROM PUBLIC, anon, authenticated;

-- 端末から書かれる、人の入力やアプリが読んだ文字列を持つ表。products などスクリプトだけが書く表は対象にしない。
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'desks', 'desk_photos', 'desk_versions', 'devices', 'connections',
    'backups', 'feedback', 'desk_reports', 'ai_response_reports', 'bookmarks', 'gadget_bookmarks'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'CREATE TRIGGER reject_mojibake BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_mojibake()',
        t
      );
    END IF;
  END LOOP;
END;
$$;
