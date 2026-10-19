// Expo の fetch は本文を ReadableStream で読める（React Native 標準の fetch は
// 全文が揃うまで返さないので、流しながら表示できない）
import { fetch as streamingFetch } from 'expo/fetch'
import { supabase, supabaseUrl } from '../../supabase/client'
import { splitStreamEvents } from './streamEvents'
import { QUICK_TIMEOUT_MS, withTimeout } from '../../utils/networkError'
import { assertResponseOrigin } from '../../utils/secureTransport'

const STREAM_IDLE_TIMEOUT_MS = 45_000
const CHAT_TIMEOUT_MS = 180_000

// client.ts と同じ値を読む。invoke を通さず自分で URL を組み立てるため、ここでも要る
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

type TextBlock = { type: 'text'; text: string }
type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  imageBase64?: string
  imageType?: string
}

// 上限は週のトークン枠だけ（supabase/migrations/120）。回数は計測のために残っている。
// tokenCount / tokenLimit はサーバーが読めなかったとき null で届く（そのときは手元の値を保つ）
export interface AIUsageInfo {
  msgCount: number
  photoCount: number
  tokenCount: number | null
  tokenLimit: number | null
  isPro: boolean
}

export class AIUsageLimitError extends Error {
  usage: AIUsageInfo | null

  constructor(message: string, usage: AIUsageInfo | null) {
    super(message)
    this.name = 'AIUsageLimitError'
    this.usage = usage
  }
}

function toApiMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    if (message.role === 'user' && message.imageBase64) {
      const blocks: Array<TextBlock | ImageBlock> = [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: message.imageType ?? 'image/jpeg',
            data: message.imageBase64,
          },
        },
      ]
      if (message.content) blocks.push({ type: 'text', text: message.content })
      return { role: message.role, content: blocks }
    }
    return { role: message.role, content: message.content }
  })
}

function toUsageInfo(raw: unknown): AIUsageInfo | null {
  const usage = raw as {
    msg_count?: number
    photo_count?: number
    token_count?: number | null
    token_limit?: number | null
    is_pro?: boolean
  } | null
  if (!usage) return null
  const tokenNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
  return {
    msgCount: usage.msg_count ?? 0,
    photoCount: usage.photo_count ?? 0,
    tokenCount: tokenNumber(usage.token_count),
    tokenLimit: tokenNumber(usage.token_limit),
    isPro: usage.is_pro === true,
  }
}

export interface ChatResult {
  content: string
  usage: AIUsageInfo | null
}

export interface ChatStreamHandlers {
  /** 届いたぶんの追記 */
  onDelta: (text: string) => void
  /** 安全性の検査に掛かったときの差し替え。すでに出ている本文を丸ごと置き換える */
  onReplace: (text: string) => void
}

/**
 * 回答を流しながら受け取る。届いた順に onDelta が呼ばれ、最後に全文と利用枠を返す。
 * lang はサーバー側のシステムプロンプト（回答言語・範囲外の案内文）の選択に使う。
 *
 * supabase.functions.invoke は本文を全部読んでから返すので使えない。
 * 認証は同じ Authorization ヘッダーを自分で付けて代替する
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  lang: 'ja' | 'en' = 'ja',
  requestId: string,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<ChatResult> {
  const controller = new AbortController()
  const aborted = new Error('Request aborted')
  aborted.name = 'AbortError'
  let rejectCancelled!: (error: Error) => void
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject })
  const onAbort = () => { controller.abort(aborted); rejectCancelled(aborted) }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    const error = new Error(`operation timed out after ${CHAT_TIMEOUT_MS}ms`)
    controller.abort(error)
    rejectCancelled(error)
  }, CHAT_TIMEOUT_MS)
  const wait = <T,>(work: Promise<T>, ms = QUICK_TIMEOUT_MS): Promise<T> => Promise.race([withTimeout(work, ms, controller.signal), cancelled])
  try {
    if (signal?.aborted) throw aborted
    const payload = JSON.stringify({ messages: toApiMessages(messages), lang, request_id: requestId, stream: true })
    const post = (accessToken: string) => streamingFetch(`${supabaseUrl}/functions/v1/ai-coach`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization:   `Bearer ${accessToken}`,
        apikey:          supabaseAnonKey,
      },
      body: payload,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    })

    const { data: sessionData } = await wait(supabase.auth.getSession())
    const accessToken = sessionData.session?.access_token
    if (!accessToken) throw new Error(lang === 'en' ? 'Please sign in to use the AI coach' : 'ログインが必要です')

    let response = await wait(post(accessToken), STREAM_IDLE_TIMEOUT_MS)
    // invoke と違い、期限切れのトークンを自分で取り直す必要がある。
    // 同じ request_id で送り直すので、枠を二重に消費することはない
    if (response.status === 401) {
      void response.body?.cancel().catch(() => {})
      const { data: refreshed } = await wait(supabase.auth.refreshSession())
      const retryToken = refreshed.session?.access_token
      if (retryToken) response = await wait(post(retryToken), STREAM_IDLE_TIMEOUT_MS)
    }
    assertResponseOrigin(response, supabaseUrl, typeof __DEV__ !== 'undefined' && __DEV__)

    // 本文を流し始める前の失敗は、これまでどおり HTTP の状態で返ってくる。
    // 403 はFreeユーザーのPro限定ゲート、429はProの週間上限。
    // どちらも画面側ではエラー吹き出しを出さず、Paywallへ誘導する
    if (!response.ok) {
      const body = await wait(response.json().catch(() => null)) as { error?: string; usage?: unknown } | null
      const detail = body?.error ?? `AIサービスでエラーが発生しました (${response.status})`
      if (response.status === 403 || response.status === 429) {
        throw new AIUsageLimitError(detail, toUsageInfo(body?.usage))
      }
      throw new Error(detail)
    }
    if (!response.body) throw new Error('AIから空のレスポンスが返されました')

    // 流す形で返ってこなかったとき（stream を知らない版の Edge Function、その版へ戻したとき）は、
    // 全文が1回で返る従来の形。配信済みのアプリはすぐには直せないので、ここで受けられるようにする
    if (!(response.headers.get('content-type') ?? '').includes('ndjson')) {
      const whole = await wait(response.json().catch(() => null), STREAM_IDLE_TIMEOUT_MS) as { content?: string; error?: string; usage?: unknown } | null
      if (whole?.error) throw new Error(whole.error)
      if (!whole?.content) throw new Error('AIから空のレスポンスが返されました')
      handlers.onDelta(whole.content)
      return { content: whole.content, usage: toUsageInfo(whole.usage) }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let usage: AIUsageInfo | null = null
    let completed = false

    try {
      for (;;) {
        const { value, done } = await wait(reader.read(), STREAM_IDLE_TIMEOUT_MS)
        // 日本語は1文字が複数バイトで、受信の切れ目が文字の途中に来る。
        // stream オプションを外すと、その境目だけ `` になる
        // EOFでも末尾の改行なしのJSONを読む。完了行を落とすと利用枠・失敗通知も失われる。
        buffer += done ? `${decoder.decode()}\n` : decoder.decode(value, { stream: true })
        const { events, rest } = splitStreamEvents(buffer)
        buffer = rest
        for (const event of events) {
          if (event.type === 'delta') {
            content += event.text
            handlers.onDelta(event.text)
          } else if (event.type === 'replace') {
            content = event.text
            handlers.onReplace(event.text)
          } else if (event.type === 'done') {
            completed = true
            usage = toUsageInfo(event.usage)
            break
          } else {
            // 生成の途中で落ちた。ここまで出ている本文は使わず、失敗として扱う
            if (event.error === 'INVALID_AI_STREAM') {
              throw new Error(lang === 'en'
                ? 'The AI response could not be received correctly. Please try again.'
                : 'AIの回答データを正しく受信できませんでした。もう一度お試しください。')
            }
            throw new Error(event.error || 'AIサービスでエラーが発生しました')
          }
        }
        if (done || completed) break
      }
    } finally {
      void reader.cancel().catch(() => {})
    }

    if (!completed) throw new Error(lang === 'en' ? 'The AI response was interrupted. Please try again.' : 'AIの回答を受信中に通信が途切れました。もう一度お試しください。')
    if (!content) throw new Error('AIから空のレスポンスが返されました')
    return { content, usage }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
