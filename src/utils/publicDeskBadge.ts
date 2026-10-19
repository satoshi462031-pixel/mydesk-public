export type PublicDeskBadgeKind = 'new' | 'updated' | null

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

interface BadgeDesk {
  id: string
  created_at?: string | null
  updated_at: string
  content_updated_at?: string | null
}

/** みんなのデスク一覧の印。新着は公開から7日間、更新は実際に開いた後の変更だけ。 */
export function publicDeskBadgeKind(
  desk: BadgeDesk,
  viewed: Readonly<Record<string, string>>,
  nowMs = Date.now(),
): PublicDeskBadgeKind {
  const viewedAt = viewed[desk.id]
  if (!viewedAt) {
    const publishedAt = Date.parse(desk.created_at ?? '')
    if (!Number.isNaN(publishedAt) && publishedAt <= nowMs && publishedAt >= nowMs - NEW_WINDOW_MS) return 'new'
    return null
  }

  const currentStamp = Date.parse(desk.content_updated_at ?? desk.updated_at)
  const viewedStamp = Date.parse(viewedAt)
  if (Number.isNaN(currentStamp) || Number.isNaN(viewedStamp)) return null
  return currentStamp > viewedStamp ? 'updated' : null
}
