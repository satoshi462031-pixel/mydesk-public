export interface AIAccessState {
  loaded: boolean
  isPro: boolean
  canUse: boolean
}

/** Pro、またはサーバーからFree利用枠を付与された利用者だけ操作を許可する。 */
export function hasAIAccess({ loaded, isPro, canUse }: AIAccessState): boolean {
  return loaded && (isPro || canUse)
}

/** Free利用枠が無い、または使い切った場合にだけ課金案内を出す。 */
export function shouldShowAIPaywall({ loaded, isPro, canUse }: AIAccessState): boolean {
  return loaded && !isPro && !canUse
}
