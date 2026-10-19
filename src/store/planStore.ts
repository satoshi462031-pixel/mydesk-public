import AsyncStorage from '@react-native-async-storage/async-storage'
import * as FileSystem from 'expo-file-system/legacy'
import { DeskPlan } from '../types'
import { runtimePlanImageUri, storedPlanImageRef } from '../utils/planImageRefs'
import { normalizePlan } from '../utils/portTypeMigration'
import { repairStoredPlans } from '../utils/storedDataRepair'

const KEY = '@desk_plans'
const ONBOARDING_KEY = '@desk_onboarding_done'

function mapPlanImages(plan: DeskPlan, map: (uri: string) => string): DeskPlan {
  if (!Array.isArray(plan.images) || !plan.images.every((uri) => typeof uri === 'string')) return plan
  const images = plan.images.map(map)
  return images.some((uri, index) => uri !== plan.images?.[index]) ? { ...plan, images } : plan
}

/**
 * 読み込めなかったときは例外を投げる。ここで [] を返すと「まだ1件も作っていない人」と
 * 区別がつかず、呼び出し側が空のメモリを正として savePlans() し、端末内のデスクを
 * まるごと空で上書きしてしまう（復旧不能）。
 */
export async function loadPlans(): Promise<DeskPlan[]> {
  const raw = await AsyncStorage.getItem(KEY)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('desk plans are not an array')

  // 壊れた1件で全デスクの画面・保存が落ちないよう、形だけ先に整える（utils/storedDataRepair.ts）
  const storedPlans = repairStoredPlans(parsed)
  const persistedPlans = storedPlans.map((plan) => mapPlanImages(plan, storedPlanImageRef))
  // 旧版が保存した file://.../<container UUID>/Documents/plan_images/... を
  // 相対参照へ一度だけ移行する。次回以降はコンテナが変わっても壊れない。
  if (persistedPlans.some((plan, index) => plan !== storedPlans[index])) {
    // 移行値を書けなくても、読み込みまで失敗扱いにはしない。次回起動時に再試行する。
    await AsyncStorage.setItem(KEY, JSON.stringify(persistedPlans)).catch(() => {})
  }

  const runtimePlans = persistedPlans.map((plan) => mapPlanImages(
    plan,
    (uri) => runtimePlanImageUri(uri, FileSystem.documentDirectory),
  ))
  // 保存済みの配線結果・配線図に残る Thunderbolt3 / Thunderbolt4 を寄せる。
  // 1件でも正規化できないデスクがあると map ごと落ちて全件を失うため、
  // 失敗したものは正規化せずそのまま残す（移行できないだけで、消しはしない）
  return runtimePlans.map((plan) => {
    try {
      return normalizePlan(plan)
    } catch {
      return plan
    }
  })
}

export async function savePlans(plans: DeskPlan[]): Promise<void> {
  const persisted = plans.map((plan) => mapPlanImages(plan, storedPlanImageRef))
  await AsyncStorage.setItem(KEY, JSON.stringify(persisted))
}

export async function addPlan(plan: DeskPlan): Promise<DeskPlan[]> {
  const current = await loadPlans()
  const updated = [...current, plan]
  await savePlans(updated)
  return updated
}

export async function updatePlan(updated: DeskPlan): Promise<DeskPlan[]> {
  const current = await loadPlans()
  const list = current.map((p) => (p.id === updated.id ? updated : p))
  await savePlans(list)
  return list
}

export async function getPlanById(id: string): Promise<DeskPlan | null> {
  const plans = await loadPlans()
  return plans.find((p) => p.id === id) ?? null
}

export async function isOnboardingDone(): Promise<boolean> {
  const val = await AsyncStorage.getItem(ONBOARDING_KEY)
  return val === 'true'
}

export async function markOnboardingDone(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, 'true')
}
