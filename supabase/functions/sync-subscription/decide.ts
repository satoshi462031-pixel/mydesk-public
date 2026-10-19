import type { ProState } from '../revenuecat-webhook/entitlement.ts'

export interface StoredTier {
  /** subscriptions の行。一度も Webhook が来ていない人は null */
  subscription: { tier: string; expires_at: string | null } | null
  profileTier:  string | null
}

export type SyncDecision = 'apply' | 'unchanged' | 'unmanaged'

function sameTime(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a == null && b == null
  return Date.parse(a) === Date.parse(b)
}

/**
 * RevenueCat の今の権利を DB に書くかどうか。
 * subscriptions の行が無い人は RevenueCat の管理下に入ったことがない。手で付けた Pro を
 * free で上書きしないよう、そういう人は Pro にするときしか書かない
 */
export function syncDecision(stored: StoredTier, state: ProState): SyncDecision {
  if (!stored.subscription) return state.tier === 'pro' ? 'apply' : 'unmanaged'
  // 期限だけずれていても書く。RENEWAL を取りこぼすと tier は pro のまま期限が古くなり、
  // is_pro_user の期限ガードで3日後にサーバーだけ Free になる
  const unchanged = stored.subscription.tier === state.tier
    && stored.profileTier === state.tier
    && sameTime(stored.subscription.expires_at, state.expiresAt)
  return unchanged ? 'unchanged' : 'apply'
}
