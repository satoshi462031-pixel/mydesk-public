// デスク一覧は常に「最後に触った順」（更新か、一覧から開いたかの新しい方）で固定する。
export type PlanSortKey = 'updatedAt' | 'createdAt' | 'name'

export const DEFAULT_PLAN_SORT: PlanSortKey = 'updatedAt'

type SortablePlan = { id: string; name: string; createdAt: string; updatedAt: string }

/**
 * 最後に触った時刻（更新か、一覧から開いたかの新しい方）。マイデスクのタブとマイページの
 * デスク一覧は同じデスクを並べるので、どちらもこれで並べる
 */
export function planTouchedAt(p: Pick<SortablePlan, 'id' | 'updatedAt'>, openedAt: Readonly<Record<string, string>>): string {
  const opened = openedAt[p.id]
  return opened && opened > p.updatedAt ? opened : p.updatedAt
}

/**
 * デスクを選ぶ一覧（機材の追加先・AIコーチ・機材詳細のデスク別の期間）の並び。
 * マイデスクのタブと同じく、作成途中 → ピン留め → 最後に触った順。
 * 作った順のまま出していて、同じデスクがマイデスクと違う位置に並んでいた
 */
export function sortPlansLikeMyDesk<T extends SortablePlan & { favorite?: boolean; wiringResult?: unknown }>(
  plans: readonly T[],
  openedAt: Readonly<Record<string, string>> | null,
): T[] {
  const opened = openedAt ?? {}
  return [...plans].sort((a, b) =>
    Number(!b.wiringResult) - Number(!a.wiringResult)
    || Number(!!b.favorite) - Number(!!a.favorite)
    || planTouchedAt(b, opened).localeCompare(planTouchedAt(a, opened)))
}

/** デスク一覧の並び替え（ピン留めを先頭に固定するのは呼び出し側の責務） */
export function comparePlansBy(key: PlanSortKey, openedAt: Readonly<Record<string, string>> = {}) {
  const touchedAt = (p: SortablePlan) => planTouchedAt(p, openedAt)
  return (a: SortablePlan, b: SortablePlan): number => {
    switch (key) {
      case 'createdAt': return b.createdAt.localeCompare(a.createdAt)
      case 'name':      return a.name.localeCompare(b.name, 'ja')
      default:          return touchedAt(b).localeCompare(touchedAt(a))
    }
  }
}
