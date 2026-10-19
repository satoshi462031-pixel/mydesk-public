import AsyncStorage from '@react-native-async-storage/async-storage'

// デスク本体の updatedAt に書かないのは、開いただけで「更新」扱いになり、
// 公開状態の読み直しやバックアップ・更新通知の対象に紛れ込むため。
const PLAN_OPENED_AT_KEY = '@plan_opened_at_v1'

export type PlanOpenedAt = Record<string, string>

export async function loadPlanOpenedAt(): Promise<PlanOpenedAt> {
  try {
    const raw = await AsyncStorage.getItem(PLAN_OPENED_AT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: PlanOpenedAt = {}
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === 'string') result[id] = at
    }
    return result
  } catch {
    return {}
  }
}

/** 残っているデスクの分だけ書き戻し、削除済みの記録を溜めない */
export async function markPlanOpenedAt(planId: string, livePlanIds: readonly string[]): Promise<void> {
  const current = await loadPlanOpenedAt()
  const next: PlanOpenedAt = {}
  for (const id of livePlanIds) {
    if (current[id]) next[id] = current[id]
  }
  next[planId] = new Date().toISOString()
  await AsyncStorage.setItem(PLAN_OPENED_AT_KEY, JSON.stringify(next))
}
