// フィードバックに添える「直前の操作」。端末のメモリにだけ持ち、外へ出すのは
// 送信フォームで本人が添付を選んだときだけ。
// 解析（PostHog）はオプトインで既定オフなので、そちらに頼ると大半の報告で
// 何をしていたかが分からず、「動かない」の一言から原因を追えない。
// 残すのは画面名と失敗イベントの固定の識別子だけで、入力内容・ID・URL は持たない。

export type TrailEntry =
  | { at: number; screen: string }
  | { at: number; failure: string; operation?: string; code?: string }

// 送信時の形。時刻は「送信の何秒前か」にする。端末の時計がずれていても読める
export type TrailSnapshotEntry =
  | { s: number; screen: string }
  | { s: number; failure: string; operation?: string; code?: string }

const MAX_ENTRIES = 30
// 固定の識別子しか入れない前提だが、万一長い値が来ても送信を肥大させない
const MAX_LABEL = 60

const entries: TrailEntry[] = []

const clip = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v.slice(0, MAX_LABEL) : undefined

function push(entry: TrailEntry): void {
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
}

export function recordScreen(name: string, now = Date.now()): void {
  const screen = clip(name)
  if (screen) push({ at: now, screen })
}

export function recordFailure(event: string, props?: Record<string, unknown>, now = Date.now()): void {
  const failure = clip(event)
  if (!failure) return
  push({ at: now, failure, operation: clip(props?.operation), code: clip(props?.error_code) })
}

export function snapshotTrail(now = Date.now()): TrailSnapshotEntry[] {
  return entries.map(({ at, ...rest }) => ({ s: Math.max(0, Math.round((now - at) / 1000)), ...rest }))
}

export function clearTrailForTest(): void {
  entries.length = 0
}
