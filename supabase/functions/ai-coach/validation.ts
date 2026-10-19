export const MAX_MESSAGES = 50
export const MAX_TEXT_CHARS = 150_000
export const MAX_IMAGE_BASE64_CHARS = 7_000_000

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type TextBlock = { type: 'text'; text: string }
export type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export type ContentBlock = TextBlock | ImageBlock

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface RequestBody {
  messages: ApiMessage[]
  lang?: 'ja' | 'en'
  request_id?: string
  /** 回答を少しずつ流してほしいか。省略時は従来どおり全文を1回で返す */
  stream?: boolean
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (!value || typeof value !== 'object') return false
  const block = value as Record<string, unknown>
  if (block.type === 'text') return typeof block.text === 'string'
  if (block.type !== 'image' || !block.source || typeof block.source !== 'object') return false
  const source = block.source as Record<string, unknown>
  return source.type === 'base64'
    && typeof source.media_type === 'string'
    && typeof source.data === 'string'
}

export function isApiMessage(value: unknown): value is ApiMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (message.role !== 'user' && message.role !== 'assistant') return false
  return typeof message.content === 'string'
    || (Array.isArray(message.content) && message.content.every(isContentBlock))
}

function imageSignatureMatches(mediaType: string, data: string): boolean {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false
  if (mediaType === 'image/jpeg') return data.startsWith('/9j/')
  if (mediaType === 'image/png') return data.startsWith('iVBORw0KGgo')
  if (mediaType === 'image/gif') return data.startsWith('R0lGOD')
  if (mediaType === 'image/webp') return data.startsWith('UklGR')
  return false
}

export function validateRequestBody(messages: ApiMessage[]): string | null {
  if (messages.length > MAX_MESSAGES) return 'messages が多すぎます'
  if (messages[messages.length - 1].role !== 'user') return 'messages の末尾は user である必要があります'
  if (messages[0].role !== 'user') return 'messages の先頭は user である必要があります'

  let textChars = 0
  let imageCount = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      textChars += message.content.length
      continue
    }
    for (const block of message.content) {
      if (block.type === 'text') {
        textChars += block.text.length
        continue
      }
      if (message.role !== 'user') return '画像はuserメッセージにだけ添付できます'
      imageCount += 1
      if (imageCount > 1) return '画像は1枚まで送信できます'
      if (!ALLOWED_IMAGE_TYPES.has(block.source.media_type)) return '未対応の画像形式です'
      if (block.source.data.length > MAX_IMAGE_BASE64_CHARS) return '画像サイズが大きすぎます'
      if (!imageSignatureMatches(block.source.media_type, block.source.data)) return '画像データが不正です'
    }
  }
  return textChars > MAX_TEXT_CHARS ? 'メッセージが長すぎます' : null
}

export function validRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
