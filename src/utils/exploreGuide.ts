export const EXPLORE_GUIDE_KEY = '@explore_guide_v1'
export const EXPLORE_GUIDE_IDS = ['explore-open-desk', 'explore-desk-tabs'] as const
export type ExploreGuideId = typeof EXPLORE_GUIDE_IDS[number]
export type ExploreGuideProgress = { seen: ExploreGuideId[]; dismissed: boolean }

export function parseExploreGuideProgress(raw: string | null): ExploreGuideProgress {
  if (raw === null) return { seen: [], dismissed: false }
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value === 'object' && value !== null && 'seen' in value && 'dismissed' in value
      && typeof value.dismissed === 'boolean' && Array.isArray(value.seen)
      && value.seen.every((id: unknown) => EXPLORE_GUIDE_IDS.includes(id as ExploreGuideId))) {
      return { seen: [...new Set(value.seen)] as ExploreGuideId[], dismissed: value.dismissed }
    }
  } catch { /* 壊れた保存値で初回案内を繰り返さない。 */ }
  return { seen: [...EXPLORE_GUIDE_IDS], dismissed: true }
}

export type GuideRect = { x: number; y: number; width: number; height: number }

export function isExploreGuideVisible(card: GuideRect, viewport: GuideRect): boolean {
  const visibleHeight = Math.min(card.y + card.height, viewport.y + viewport.height) - Math.max(card.y, viewport.y)
  const visibleWidth = Math.min(card.x + card.width, viewport.x + viewport.width) - Math.max(card.x, viewport.x)
  return card.height > 0 && card.width > 0
    && visibleHeight >= Math.min(card.height, 160) && visibleWidth >= card.width * 0.9
}
