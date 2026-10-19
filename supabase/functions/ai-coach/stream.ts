/**
 * Anthropic の SSE（stream: true）を読むための部品。index.ts はここで取り出した
 * 本文の差分・使用トークン・停止理由を、端末向けの NDJSON に詰め替えて流す。
 *
 * 端末へ返す形式を SSE ではなく NDJSON（1行1 JSON）にしているのは、
 * アプリ側の読み手を「行で割って JSON にする」だけで済ませるため。
 * event 名や id を運ぶ必要が無いので、SSE の枠組みは上流を読むところだけで足りる。
 */

/** 端末へ流す1件。delta=本文の追記、replace=本文の差し替え、done=正常終了、error=異常終了 */
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'replace'; text: string }
  | { type: 'done'; usage: unknown; safety_filtered: boolean }
  | { type: 'error'; error: string; status: number }

export function ndjson(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * 受信したぶんから `data:` 行を取り出す。チャンクは行の途中で切れるので、
 * 末尾の未完の行は rest として返し、呼び出し側が次のチャンクの頭に戻す。
 * 戻し忘れると、切れた JSON を捨てて本文が虫食いになる
 */
export function splitSseData(buffer: string): { data: string[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const data: string[] = []
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }
  return { data, rest }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

/** content_block_delta の本文。text 以外のブロック（思考など）は本文に混ぜない */
export function streamTextDelta(event: unknown): string | null {
  const record = asRecord(event)
  if (!record || record.type !== 'content_block_delta') return null
  const delta = asRecord(record.delta)
  if (!delta || delta.type !== 'text_delta' || typeof delta.text !== 'string') return null
  return delta.text
}

const USAGE_FIELDS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const

/**
 * tokenBudget.ts の AnthropicUsage と同じ形。この形をここで組み立てているのは、
 * Deno（拡張子付きの import）と node:test（拡張子なし）の両方から読まれるファイルに
 * 相対 import を持たせないため
 */
export type StreamUsage = { [K in (typeof USAGE_FIELDS)[number]]?: number }

/**
 * 使用トークン。message_start に入力ぶん、message_delta に出力ぶんが乗る。
 * どちらも部分的なので mergeStreamUsage で合わせていく
 */
export function streamUsage(event: unknown): StreamUsage | null {
  const record = asRecord(event)
  if (!record) return null
  if (record.type === 'message_start') {
    const message = asRecord(record.message)
    return message ? asRecord(message.usage) as StreamUsage | null : null
  }
  if (record.type === 'message_delta') return asRecord(record.usage) as StreamUsage | null
  return null
}

/**
 * 同じ項目は大きい方を採る。output_tokens は message_start で 1 のような途中経過が
 * 乗ることがあり、上書きにすると最後の合計を小さい値で潰してしまう
 */
export function mergeStreamUsage(base: StreamUsage, next: StreamUsage | null): StreamUsage {
  if (!next) return base
  const merged: StreamUsage = { ...base }
  for (const field of USAGE_FIELDS) {
    const value = next[field]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue
    const current = merged[field]
    merged[field] = typeof current === 'number' ? Math.max(current, value) : value
  }
  return merged
}

/** 出力ぶんの確定値が乗るのは message_delta だけ。途中で止めたときはこれが来ない */
export function isFinalUsageEvent(event: unknown): boolean {
  return asRecord(event)?.type === 'message_delta'
}

/**
 * 途中で止めたときの出力トークンの概算。確定値が来ないまま精算すると、
 * 実際に生成させたぶんを無かったことにしてしまう。日本語は1トークンが1〜2字なので
 * 2字=1トークンで見積もり、予約したぶん（max_tokens）は超えないようにする
 */
export function estimateOutputTokens(text: string, maxTokens: number): number {
  return Math.min(maxTokens, Math.ceil(text.length / 2))
}

/** 出力上限で切れたかどうかの判定に使う停止理由 */
export function streamStopReason(event: unknown): string | null {
  const record = asRecord(event)
  if (!record || record.type !== 'message_delta') return null
  const delta = asRecord(record.delta)
  return delta && typeof delta.stop_reason === 'string' ? delta.stop_reason : null
}

/** 上流が途中でエラーに転んだとき（overloaded など）。HTTP は 200 のまま来る */
export function streamErrorType(event: unknown): string | null {
  const record = asRecord(event)
  if (!record || record.type !== 'error') return null
  const error = asRecord(record.error)
  return error && typeof error.type === 'string' ? error.type : 'error'
}

/**
 * 安全性の検査に掛ける範囲。流しながら調べるので、差分が届くたびに全文を
 * 走査すると長い回答で二乗に効く。規則はどれも 200 字に収まる長さなので、
 * 末尾のこれだけ見れば、出来上がった一致を取り逃さない
 */
export const SAFETY_SCAN_TAIL = 1024

export function safetyScanTail(content: string): string {
  return content.length <= SAFETY_SCAN_TAIL ? content : content.slice(-SAFETY_SCAN_TAIL)
}
