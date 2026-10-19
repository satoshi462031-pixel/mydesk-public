import { supabase } from '../supabase/client'
import { trimAndTruncate, truncateChars } from '../utils/truncateText'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

export type AIReportReason = 'unsafe' | 'inaccurate'

const MAX_RESPONSE_LENGTH = 8_000
const MAX_PROMPT_LENGTH = 2_000

interface AIReportInput {
  reason: AIReportReason
  response: string
  prompt?: string
  conversationId: string
  messageId: string
}

export async function submitAIReport(input: AIReportInput): Promise<void> {
  if (!['unsafe', 'inaccurate'].includes(input.reason)
    || typeof input.conversationId !== 'string' || !input.conversationId.trim() || input.conversationId.length > 100
    || typeof input.messageId !== 'string' || !input.messageId.trim() || input.messageId.length > 100) throw new Error('INVALID_AI_REPORT')
  const response = input.response.trim()
  if (!response) throw new Error('報告対象の回答がありません。')
  const { data: { user }, error: authError } = await withTimeout(supabase.auth.getUser(), QUICK_TIMEOUT_MS)
  if (authError) throw authError
  if (!user) throw new Error('報告するにはログインしてください。')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), QUICK_TIMEOUT_MS)
  try {
    const { error } = await withTimeout(Promise.resolve(supabase.from('ai_response_reports').insert({
      reporter_id: user.id,
      reason: input.reason,
      response_text: truncateChars(response, MAX_RESPONSE_LENGTH),
      prompt_text: (input.prompt ? trimAndTruncate(input.prompt, MAX_PROMPT_LENGTH) : '') || null,
      conversation_id: input.conversationId,
      message_id: input.messageId,
    }).abortSignal(controller.signal)), QUICK_TIMEOUT_MS)
    if (error) throw error.message === 'REPORT_RATE_LIMITED' ? new Error('REPORT_RATE_LIMITED') : error
  } finally {
    clearTimeout(timeout)
  }
}

