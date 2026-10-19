// 拍手を持ち主へ通知するかどうかの判定（096）。Deno にも node:test にも読めるよう、依存を持たない。

// 同じ人へ続けて届くと、反響ではなく騒音になる。最初の1件はすぐ届け、あとは間を空ける
export const CLAP_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
// 一度も送っていない人の「新しい拍手」はこの時間まで遡る。機能が入る前の拍手を
// 新しいものとして数えないため
export const CLAP_FIRST_WINDOW_MS = 24 * 60 * 60 * 1000

export interface ClapRecord {
  user_id: string
  created_at: string
  round_at: string
}

export interface ClapCounts {
  /** 前の通知より後に届いた拍手 */
  fresh: number
  /** 今の版（最後の更新）への拍手。通知の文面に出す */
  round: number
}

/** 持ち主本人とブロック関係にある人の拍手は数えない */
export function countClaps(
  claps: readonly ClapRecord[],
  opts: { ownerId: string; blocked: ReadonlySet<string>; roundAt: string; lastSentAt: string | null; now: number },
): ClapCounts {
  const since = opts.lastSentAt ? Date.parse(opts.lastSentAt) : opts.now - CLAP_FIRST_WINDOW_MS
  let fresh = 0
  let round = 0
  for (const clap of claps) {
    if (clap.user_id === opts.ownerId || opts.blocked.has(clap.user_id)) continue
    if (Date.parse(clap.created_at) > since) fresh += 1
    // 版は同じ列型を同じ書式で返すので文字列で比べる（Date に直すとマイクロ秒が落ちる）
    if (clap.round_at === opts.roundAt) round += 1
  }
  return { fresh, round }
}

export type ClapPushDecision =
  | { send: true }
  | { send: false; reason: 'disabled' | 'no_new' | 'throttled' }

export function decideClapPush(
  input: { enabled: boolean; fresh: number; lastSentAt: string | null },
  now: number,
): ClapPushDecision {
  if (!input.enabled) return { send: false, reason: 'disabled' }
  if (input.fresh === 0) return { send: false, reason: 'no_new' }
  if (input.lastSentAt && now - Date.parse(input.lastSentAt) < CLAP_MIN_INTERVAL_MS) {
    return { send: false, reason: 'throttled' }
  }
  return { send: true }
}
