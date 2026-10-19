-- フィードバックに再現用の環境と、本人が添付を選んだ場合の直前の操作を持たせる。
-- 返信の手段が無く聞き返せないため、送信の時点で揃っていないものは後から分からない。
-- 版番号（app_version）だけでは、同じ版番号の OTA 更新で直したかどうかを判定できない
-- （runtimeVersion が appVersion 方式）ので、どの JS バンドルかもここに入る。
--
-- 形は src/services/feedbackService.ts の buildContext。入力内容・デスク内容・端末の識別子は入れない。

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS context JSONB;

-- 直前の操作は最大30件の固定識別子なので数KBに収まる。書けるのは本人の INSERT だけだが、
-- 上限が無いと1行に任意の大きさの JSON を積める
ALTER TABLE public.feedback
  DROP CONSTRAINT IF EXISTS feedback_context_size;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_context_size CHECK (
    context IS NULL OR (jsonb_typeof(context) = 'object' AND octet_length(context::TEXT) <= 16384)
  );
