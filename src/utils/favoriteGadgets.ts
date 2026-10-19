import type { DeskPlan } from '../types'

/**
 * デスクごとの「おすすめ」。既存の公開データとの互換性のため保存キーは維持する。
 *
 * 公開デスクの値は投稿者の端末が書いた JSON がそのまま来るので、読む口はすべてここを通して
 * 配列・文字列かを確かめる（配列でない値を Set や includes に渡すと画面ごと落ちる）
 */
function favoriteIdsOf(plan: Pick<DeskPlan, 'favoriteGadgetIds'> | null | undefined): string[] {
  const value: unknown = plan?.favoriteGadgetIds
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export function favoriteGadgetIdSet(plan: Pick<DeskPlan, 'favoriteGadgetIds'> | null | undefined): ReadonlySet<string> {
  return new Set(favoriteIdsOf(plan))
}

export function toggleFavoriteGadget(plan: DeskPlan, gadgetId: string): DeskPlan {
  const current = favoriteIdsOf(plan)
  const next = current.includes(gadgetId)
    ? current.filter((id) => id !== gadgetId)
    : [...current, gadgetId]
  return { ...plan, favoriteGadgetIds: next.length > 0 ? next : undefined }
}

/**
 * 公開・指紋に載せるおすすめ。デスクから外した機材の印は残っていても出さない
 * （外したあと戻せば推しのまま戻るよう、保存値からは消さない）
 */
export function publishedFavoriteGadgetIds(plan: Pick<DeskPlan, 'favoriteGadgetIds' | 'selectedGadgetIds'>): string[] {
  const selected = new Set(plan.selectedGadgetIds)
  return [...new Set(favoriteIdsOf(plan))].filter((id) => selected.has(id)).sort()
}
