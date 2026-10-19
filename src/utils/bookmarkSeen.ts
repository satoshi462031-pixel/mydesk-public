// 保存したデスクの「どこまで見たか」を端末に記録する。
// 更新一覧（DeskUpdatesScreen）とブックマーク一覧が同じ記録を共有するので、
// どちらで開いても既読になる。サーバー側の未読管理は持たない。
// いいねは監視の対象ではない（services/deskUpdates.ts の頭を参照）。
//
// 比べるのは deskUpdateStamp()＝機材・写真が変わった日時（061）。
// desks.updated_at はタイトルの直しや再公開でも進むため、それで比べると
// 中身が同じデスクを「更新された」と言うことになる。
import AsyncStorage from '@react-native-async-storage/async-storage'
import { NEW_DESK_SEEN } from './deskUpdateFeed'

const KEY = '@bookmark_seen'

/** desk_id → 既読にした時点の deskUpdateStamp() */
export type SeenMap = Record<string, string>

/**
 * 既読の比較に使う時刻。機材・写真が変わった日時（061）を優先し、
 * まだ指紋を持っていないデスクだけ updated_at に落ちる。
 * 記録する側と比べる側で必ず同じ値を使うこと（片方だけ変えるとバッジが出なくなる）。
 */
export function deskUpdateStamp(
  desk: { updated_at: string; content_updated_at?: string | null },
): string {
  return desk.content_updated_at ?? desk.updated_at
}

// 一覧の再読み込み（syncSeen）とデスクを開いた記録（markSeen）は同時に走りうる。
// それぞれが read-modify-write すると後勝ちで既読マークが消え、開いたはずの
// デスクにバッジが復活する。最新状態はここに持ち、書き込みは直列化する。
let cache: SeenMap | null = null
let queue: Promise<void> = Promise.resolve()
let loadPromise: Promise<SeenMap> | null = null

async function load(): Promise<SeenMap> {
  if (cache) return cache
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY)
        const parsed = raw ? JSON.parse(raw) : null
        cache = parsed && typeof parsed === 'object' ? (parsed as SeenMap) : {}
      } catch {
        cache = {}
      }
      return cache
    })().finally(() => { loadPromise = null })
  }
  return loadPromise
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.catch(() => {}).then(task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

/** cache を次の値に進めてから永続化する。永続化の失敗は無視（次回起動で戻るだけ） */
async function commit(next: SeenMap): Promise<void> {
  cache = next
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {})
}

// 前回の同期で既に追っていたフォロー相手。これが無いと「フォローした直後に見えた
// 既存のデスク」と「フォロー後に新しく公開されたデスク」を区別できない
const FOLLOWEES_KEY = '@followed_users_seen'

async function loadKnownFollowees(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(FOLLOWEES_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * 一覧の読み込み時に呼ぶ。
 * 初めて見るデスクは現在の値で既読にする（保存した直後に全件へバッジが出ると
 * 意味を成さないため）。
 *
 * 例外はフォロー中の人の新しいデスク（ownerId 付きの行）。前回の同期でもう追っていた
 * 相手のデスクに記録が無い＝その後に公開されたものなので、NEW_DESK_SEEN を入れて
 * 未読で出す。フォローした直後の相手は前回の記録に無いので、既存のデスクは既読で始まる。
 * followees を渡した呼び出しだけがこの記録を読み書きする（同じ直列の中で行うのは、
 * ベルと更新一覧が並んで走ると、片方が記録を進めた後にもう片方が既存デスクを新規と誤るため）。
 *
 * prune は「この一覧に無いデスクの記録を捨てる」指示。更新一覧とベルは保存と
 * フォローの全範囲を見ているので true。保存一覧はフォローぶんを持っていないので
 * false で呼ぶ（捨てると、フォロー中の人の既存デスクが次の同期で新規に化ける）。
 */
export async function syncSeen(
  desks: Array<{ deskId: string; updatedAt: string; ownerId?: string }>,
  { prune = true, followees }: { prune?: boolean; followees?: readonly string[] } = {},
): Promise<SeenMap> {
  return serialize(async () => {
    const prev = await load()
    const known = followees ? await loadKnownFollowees() : new Set<string>()
    const next: SeenMap = prune ? {} : { ...prev }
    let changed = prune && Object.keys(prev).length !== desks.length

    for (const { deskId, updatedAt, ownerId } of desks) {
      next[deskId] = prev[deskId] ?? (ownerId && known.has(ownerId) ? NEW_DESK_SEEN : updatedAt)
      if (prev[deskId] === undefined) changed = true
    }

    if (followees) await AsyncStorage.setItem(FOLLOWEES_KEY, JSON.stringify(followees)).catch(() => {})
    if (!changed) return prev
    await commit(next)
    return next
  })
}

// ─── ベルの点 ────────────────────────────────────────────────────
// 「未読が1件でもあるか」だけを持つ。個々のデスクの既読とは別で、
// 更新一覧を開いた時点で点は消える（YouTube と同じ。中身は開くまで残る）
const BELL_KEY = '@desk_updates_seen_at'

export async function getBellSeenAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(BELL_KEY)
  } catch {
    return null
  }
}

/**
 * 更新一覧を開いたときに呼ぶ。
 * `at` には**サーバー時刻**（見た中でいちばん新しい deskUpdateStamp）を渡す。
 * 比べる相手がサーバー時刻なので、端末の現在時刻を入れると時計のずれぶん
 * 判定が狂う（既定値は対象が 0 件のときのため）。
 */
export async function markBellSeen(at: string = new Date().toISOString()): Promise<void> {
  await AsyncStorage.setItem(BELL_KEY, at).catch(() => {})
}

/** そのデスクを開いた時に呼ぶ。バッジを消す。 */
export async function markSeen(deskId: string, updatedAt: string): Promise<void> {
  const updatedTime = Date.parse(updatedAt)
  if (Number.isNaN(updatedTime)) return
  await serialize(async () => {
    const prev = await load()
    // 古い一覧や遅れて返った応答で、詳細画面が進めた既読時刻を巻き戻さない。
    if (Date.parse(prev[deskId]) >= updatedTime) return
    await commit({ ...prev, [deskId]: updatedAt })
  })
}

/** ログアウト時に呼ぶ。次のアカウントに前のアカウントの既読が残らないようにする */
export async function clearSeenCache(): Promise<void> {
  await queue.catch(() => {})
  cache = null
  loadPromise = null
}

/**
 * 既読記録が無いものは「更新あり」にしない。
 * 記録が無い＝ブックマークした直後（syncSeen 前）で、更新の有無を判断できないため。
 */
export function hasUpdate(seen: SeenMap, deskId: string, updatedAt: string): boolean {
  const seenAt = seen[deskId]
  if (!seenAt) return false
  return Date.parse(updatedAt) > Date.parse(seenAt)
}
