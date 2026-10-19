import { useCallback } from 'react'
import { BooleanLimitKey, NumericLimitKey, PLAN_LIMITS } from '../constants/plans'
import { useSubscription } from '../context/SubscriptionContext'

export function useEntitlement() {
  const { tier, isPro, isLoading } = useSubscription()

  // RevenueCat の確認中は Pro の枠を表示し、確認前の誤った購入案内を避ける。
  // デスクの保存時には usePlans が確認待ちを行う。
  const limits = isLoading ? PLAN_LIMITS.pro : PLAN_LIMITS[tier]

  // 数値制限チェック: current < max（max -1 = 無制限）
  const checkLimit = useCallback(
    (key: NumericLimitKey, current: number): boolean => {
      const max = limits[key] as number
      return max === -1 || current < max
    },
    [limits],
  )

  // 最大値を返す（-1 = 無制限）
  const getLimit = useCallback(
    (key: NumericLimitKey): number => limits[key] as number,
    [limits],
  )

  // boolean フィーチャーが使えるか
  const hasFeature = useCallback(
    (key: BooleanLimitKey): boolean => limits[key] as boolean,
    [limits],
  )

  // 残り枠を返す（無制限の場合は Infinity）
  const remaining = useCallback(
    (key: NumericLimitKey, current: number): number => {
      const max = limits[key] as number
      if (max === -1) return Infinity
      return Math.max(0, max - current)
    },
    [limits],
  )

  return { tier, isPro, isLoading, limits, checkLimit, getLimit, hasFeature, remaining }
}
