import { useEffect, useState } from 'react'
import { loadPlanOpenedAt, PlanOpenedAt } from '../store/planOpenedStore'

/**
 * デスクを一覧から開いた時刻。デスクを選ぶ一覧をマイデスクと同じ並びにするのに使う。
 * 読めるまでは null（並べる側は更新日時だけで並べる）。選ぶ一覧は開いてすぐ使うので、読み直しはしない
 */
export function usePlanOpenedAt(): PlanOpenedAt | null {
  const [openedAt, setOpenedAt] = useState<PlanOpenedAt | null>(null)
  useEffect(() => {
    let alive = true
    void loadPlanOpenedAt().then((value) => { if (alive) setOpenedAt(value) })
    return () => { alive = false }
  }, [])
  return openedAt
}
