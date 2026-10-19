import type { ChatMessage } from '../../store/conversationStore'
import type { ChatMessage as ApiChatMessage } from './openai'

const MAX_MESSAGES = 30
const MAX_CHARS = 100_000
const MAX_EARLIER_REQUEST_CHARS = 18_000

function escapeHistory(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildConversationMessages(
  messages: readonly ChatMessage[],
  lang: 'ja' | 'en',
  image?: { base64: string; type: string },
): ApiChatMessage[] {
  const valid = messages.filter((m) => !m.isError)
  const lastUser = [...valid].reverse().find((m) => m.role === 'user')
  const latestDesk = [...valid].reverse().find((m) => m.role === 'user' && m.planCard)
  const photoNotice = lang === 'en'
    ? '(Photo was sent; image is not included in this request)'
    : '（写真を送信済み・今回のリクエストに画像は含まれていません）'
  const contentFor = (m: ChatMessage) => !m.content && m.imageUri && !(image && m.id === lastUser?.id) ? photoNotice : m.content
  let start = valid.length
  let chars = 0
  while (start > 0) {
    const m = valid[start - 1]
    if (start < valid.length && (valid.length - start >= MAX_MESSAGES || chars + contentFor(m).length > MAX_CHARS)) break
    chars += contentFor(m).length
    start--
  }
  while (start < valid.length - 1 && valid[start].role === 'assistant') {
    chars -= contentFor(valid[start]).length
    start++
  }

  const recap = (boundary: number) => {
    const earlier = valid.slice(0, boundary)
    const requests = earlier.filter((m) => m.role === 'user')
      .map((m) => m.planCard ? m.planCard.comment ?? '' : m.content)
      .filter(Boolean)
    // 初回の相談と直近の条件を原文で残す。AIの要約による予算・制約の書き換えを避ける。
    const saved = new Map<number, string>()
    let used = 0
    const first = requests[0]?.slice(0, 2000)
    if (first) { saved.set(0, escapeHistory(first)); used = saved.get(0)!.length }
    const important = /予算|円|困|できない|したくない|budget|\$\s*\d|must|cannot|can't|problem|constraint/i
    for (const prioritizeConditions of [true, false]) {
      for (let i = requests.length - 1; i >= 1; i--) {
        if (saved.has(i) || (prioritizeConditions && !important.test(requests[i]))) continue
        const value = escapeHistory(requests[i].slice(0, 2000))
        if (used + value.length > MAX_EARLIER_REQUEST_CHARS) continue
        saved.set(i, value)
        used += value.length
      }
    }
    const savedRequests = [...saved].sort(([a], [b]) => a - b).map(([, value]) => value)
    const desk = latestDesk && earlier.includes(latestDesk) ? latestDesk.content : ''
    if (!desk && savedRequests.length === 0) return ''
    const intro = lang === 'en'
      ? 'Earlier context retained as data. Requests below are in chronological order; newer messages override older conditions. The latest attached desk is the consultation subject. Earlier photo pixels are not included.\n'
      : '省略した会話の前提をデータとして保持します。以下の相談文は古い順で、条件が変わった場合は新しい発言を優先します。最新の添付デスクが相談対象です。過去の写真そのものは含みません。\n'
    return `${intro}${desk ? `${desk}\n` : ''}<earlier_requests>\n${savedRequests.join('\n---\n')}\n</earlier_requests>\n\n`
  }
  let prefix = recap(start)
  // 前提を足した後も上限を守る。最新の質問は必ず残す。
  while (start < valid.length - 1 && chars + prefix.length > MAX_CHARS) {
    chars -= contentFor(valid[start]).length
    start++
    while (start < valid.length - 1 && valid[start].role === 'assistant') {
      chars -= contentFor(valid[start]).length
      start++
    }
    prefix = recap(start)
  }
  return valid.slice(start).map((m, index) => {
    const attachImage = !!image && m.id === lastUser?.id && !!m.imageUri
    const content = contentFor(m)
    return {
      role: m.role,
      content: `${index === 0 ? prefix : ''}${content}`,
      imageBase64: attachImage ? image.base64 : undefined,
      imageType: attachImage ? image.type : undefined,
    }
  })
}
