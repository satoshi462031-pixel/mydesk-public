import { formatRelativeDay } from './dateFormat'
import { truncateChars } from './truncateText'

// ─── 一覧のカードに出す更新マーク ─────────────────────────────────
// 更新日を文字で出すだけでは、機材を入れ替えた日なのかタイトルを直した日なのかが
// 外から区別できない。機材か写真が変わった日（061 の content_updated_at）が
// 近いときだけ、写真の上にマークを出す。
//
// 期限を切るのは、出しっぱなしのマークが読み飛ばされるため。常に点いている印は
// 数日で壁紙になり、本当に変わったときにも効かなくなる（Apple の HIG が
// 「読んだらすぐ消せ」と言っているのと同じ理由）
const CONTENT_UPDATE_RECENT_DAYS = 14

export function publicDeskUpdateBadge(
  row: { content_updated_at?: string | null },
  lang: 'ja' | 'en',
  now = new Date(),
): string | null {
  const at = row.content_updated_at ? Date.parse(row.content_updated_at) : NaN
  if (Number.isNaN(at)) return null
  if (now.getTime() - at > CONTENT_UPDATE_RECENT_DAYS * 86_400_000) return null
  const relative = formatRelativeDay(row.content_updated_at as string, lang, now)
  return lang === 'en' ? `Updated ${relative}` : `機材更新 ${relative}`
}

export interface PublicDeskFeedRow {
  id: string
  user_id: string
  updated_at: string
}

// ─── 続きの読み出し位置 ─────────────────────────────────────────
// 更新日時だけを位置にすると、ページの境目に同じ日時のデスクが並んだとき（同じ人の全デスクを
// 1回で書き換える更新で日時が揃う）、2ページ目の「より前」で残りが飛ばされる。
// 並びの2番目の鍵（id）も位置に入れる。古い形（日時だけ）もそのまま読める
const CURSOR_SEPARATOR = '|'

export function publicDeskCursorOf(row: Pick<PublicDeskFeedRow, 'id' | 'updated_at'>): string {
  return `${row.updated_at}${CURSOR_SEPARATOR}${row.id}`
}

export function parsePublicDeskCursor(cursor: string): { updatedAt: string; id?: string } {
  const at = cursor.indexOf(CURSOR_SEPARATOR)
  if (at < 0) return { updatedAt: cursor }
  return { updatedAt: cursor.slice(0, at), id: cursor.slice(at + 1) || undefined }
}

/** 「みんなのデスク」に出してよい行だけを残す。自分とブロック対象は入口によらず除外する。 */
export function filterPublicDiscoveryRows<T extends { user_id: string }>(
  rows: readonly T[],
  userId: string | undefined,
  blockedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !blockedIds.has(row.user_id) && row.user_id !== userId)
}

export const PUBLIC_DESK_SEARCH_MAX_LENGTH = 80

export function normalizePublicDeskSearch(value: string): string {
  return truncateChars(value.normalize('NFKC').trim().replace(/\s+/g, ' '), PUBLIC_DESK_SEARCH_MAX_LENGTH)
}

export interface VisiblePublicDeskPage<T extends PublicDeskFeedRow> {
  visible: T[]
  end: boolean
  nextBefore: string | undefined
}

/** 除外対象だけのページを越えて、実際に表示できる次のページまで取得する。 */
export async function loadVisiblePublicDeskPage<T extends PublicDeskFeedRow>({
  pageSize,
  before,
  userId,
  blockedIds,
  loadPage,
}: {
  pageSize: number
  before?: string
  userId?: string
  blockedIds: ReadonlySet<string>
  loadPage: (before?: string) => Promise<T[]>
}): Promise<VisiblePublicDeskPage<T>> {
  const visible: T[] = []
  let cursor = before
  let end = false

  while (visible.length === 0 && !end) {
    const rows = await loadPage(cursor)
    visible.push(...filterPublicDiscoveryRows(rows, userId, blockedIds))
    end = rows.length < pageSize
    const last = rows[rows.length - 1]
    cursor = last ? publicDeskCursorOf(last) : undefined
    if (rows.length === 0) end = true
  }

  return { visible, end, nextBefore: cursor }
}
