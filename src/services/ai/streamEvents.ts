/**
 * AIコーチの回答を流しながら受け取るときの、1行1 JSON を解くところ。
 * 送り手は supabase/functions/ai-coach/stream.ts。
 *
 * 受信の切れ目は行の途中に来る。末尾の未完の行を rest として返し、
 * 次の受信の頭に戻すのが読み手の責任（戻さないと本文が虫食いになる）
 */

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'done'; usage?: unknown; safety_filtered?: boolean }
  | { type: 'error'; error: string; status: number }

function toEvent(value: unknown): ChatStreamEvent | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if ((record.type === 'delta' || record.type === 'replace') && typeof record.text === 'string') {
    return { type: record.type, text: record.text }
  }
  if (record.type === 'done') {
    return { type: 'done', usage: record.usage, safety_filtered: record.safety_filtered === true }
  }
  if (record.type === 'error') {
    return {
      type:   'error',
      error:  typeof record.error === 'string' ? record.error : '',
      status: typeof record.status === 'number' ? record.status : 500,
    }
  }
  return null
}

export function splitStreamEvents(buffer: string): { events: ChatStreamEvent[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: ChatStreamEvent[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      events.push({ type: 'error', error: 'INVALID_AI_STREAM', status: 502 })
      break
    }
    const event = toEvent(parsed)
    if (event) events.push(event)
    else if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || typeof parsed.type !== 'string'
      || ['delta', 'replace', 'done', 'error'].includes(parsed.type)) {
      events.push({ type: 'error', error: 'INVALID_AI_STREAM', status: 502 })
      break
    }
  }
  return { events, rest }
}
