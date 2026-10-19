// フォロワーへ通知するかどうかの判定（085）。Deno にも node:test にも読めるよう、依存を持たない。

// 同じデスクから続けて届くと、細かく直す人をフォローしただけで通知が埋まる
export const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
// 変化がこの時間より前なら知らせない。この機能より前の変更や、非公開の間の変更を、
// 公開し直しただけで「いま更新した」と伝えないため。初回公開・更新は公開の直後に呼ばれるので足りる
export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000
// 間隔の記録（desk_push_log）はデスクごとで、デスクを消すと一緒に消える。作っては消すだけで
// フォロワー全員へ「新しいデスク」を撃てるので、持ち主ごとにも間隔を置く（106）
export const OWNER_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000

export function ownerThrottled(lastSentAt: string | null | undefined, now: number): boolean {
  return lastSentAt != null && now - Date.parse(lastSentAt) < OWNER_MIN_INTERVAL_MS
}

export interface DeskStamps {
  created_at: string
  /** サーバーのトリガ（061）が、機材か写真が変わったときだけ進める */
  content_updated_at: string | null
}

export interface PushLog {
  last_stamp: string
  last_sent_at: string
}

export type PushDecision =
  | { send: true; kind: 'new' | 'updated'; stamp: string }
  | { send: false; reason: 'no_change' | 'stale' | 'throttled' }

export function decidePush(desk: DeskStamps, log: PushLog | null, now: number): PushDecision {
  // 中身が一度も変わっていない＝初回公開のまま
  const kind = desk.content_updated_at ? 'updated' : 'new'
  const stamp = desk.content_updated_at ?? desk.created_at
  if (log && Date.parse(stamp) <= Date.parse(log.last_stamp)) return { send: false, reason: 'no_change' }
  if (now - Date.parse(stamp) > FRESH_WINDOW_MS) return { send: false, reason: 'stale' }
  if (log && now - Date.parse(log.last_sent_at) < MIN_INTERVAL_MS) return { send: false, reason: 'throttled' }
  return { send: true, kind, stamp }
}
