const FORBIDDEN_ANALYTICS_KEYS = new Set([
  'email',
  'name',
  'desk_name',
  'public_nickname',
  'product_name',
  'query',
  'message',
  'stack',
  'url',
  'token',
  'access_token',
  'refresh_token',
  'description',
  'feedback_body',
  'deskId',
  'desk_id',
  'userId',
  'user_id',
  'gadgetId',
  'gadget_id',
  'conversationId',
  'conversation_id',
  'messageId',
  'message_id',
  'prompt',
  'response',
])

/** 自由入力や永続IDをPostHogへ送らないための最終防衛線。 */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !FORBIDDEN_ANALYTICS_KEYS.has(key)),
  )
}
