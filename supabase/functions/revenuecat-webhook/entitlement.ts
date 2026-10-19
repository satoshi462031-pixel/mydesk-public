// RevenueCat REST API（GET /v1/subscribers/{app_user_id}）が返す、エンタイトルメント1件の形。
// フィールド名は Customer Info Model の定義どおり
export interface RCEntitlement {
  expires_date?:              string | null
  grace_period_expires_date?: string | null
  product_identifier?:        string | null
}

/** GET /v1/subscribers の subscriber のうち、権利の出どころ（Sandbox か）を見るのに使う部分 */
export interface RCSubscriber {
  entitlements?:      Record<string, RCEntitlement>
  subscriptions?:     Record<string, { is_sandbox?: boolean } | undefined>
  non_subscriptions?: Record<string, Array<{ is_sandbox?: boolean }> | undefined>
}

/**
 * 権利が Sandbox（TestFlight・審査・開発ビルド）の購入から来ているか。
 * TestFlight の購読は無料なので、本番の Pro（AI コーチの費用）として数えるかは別に決める
 */
export function isSandboxEntitlement(subscriber: RCSubscriber | null | undefined, entitlement: RCEntitlement | null | undefined): boolean {
  const product = entitlement?.product_identifier
  if (!product) return false
  const subscription = subscriber?.subscriptions?.[product]
  if (subscription) return subscription.is_sandbox === true
  const purchases = subscriber?.non_subscriptions?.[product]
  return Array.isArray(purchases) && purchases.length > 0 && purchases.every((purchase) => purchase.is_sandbox === true)
}

/**
 * Sandbox の権利をこの人の Pro として数えるか。
 * 許可リスト（REVENUECAT_SANDBOX_USER_IDS）があればそこに載っている人だけ。無ければ
 * REVENUECAT_ALLOW_SANDBOX に従う（審査員が自分で作ったアカウントで買っても解放されるように、
 * 審査が終わるまではリストを空のままにする運用もできる）
 */
export function sandboxCounts(userId: string, allowAll: boolean, allowlist: ReadonlySet<string>): boolean {
  return allowlist.size > 0 ? allowlist.has(userId.toLowerCase()) : allowAll
}

export function parseSandboxAllowlist(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((id) => id.trim().toLowerCase()).filter(Boolean))
}

export interface ProState {
  tier:      'free' | 'pro'
  /** is_pro_user の期限ガードに渡す。猶予期間中は猶予の終わり。買い切り（期限なし）は null */
  expiresAt: string | null
  productId: string | null
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/**
 * 購読者の現在のエンタイトルメントから tier を決める。
 *
 * イベントの種類から推し量らない。BILLING_ISSUE の expiration_at_ms は元の期限で、猶予中にも
 * CANCELLATION が届く。一時停止（SUBSCRIPTION_PAUSED）は期間の終わりまで使える。
 * どれもイベント単体では判断を誤るので、RevenueCat が計算した今の権利を正本にする。
 */
export function proStateFrom(entitlement: RCEntitlement | null | undefined, now: number): ProState {
  if (!entitlement) return { tier: 'free', expiresAt: null, productId: null }
  const productId = entitlement.product_identifier ?? null
  // expires_date が null なのは期限の無い権利（買い切り・プロモーションの無期限付与）
  if (entitlement.expires_date == null) return { tier: 'pro', expiresAt: null, productId }

  const expires = parseTime(entitlement.expires_date)
  const grace = parseTime(entitlement.grace_period_expires_date)
  const until = Math.max(expires ?? 0, grace ?? 0)
  // 期限が読めないものは付与しない（壊れた値で権利を配らない）
  if (until === 0) return { tier: 'free', expiresAt: null, productId }
  return {
    tier: until > now ? 'pro' : 'free',
    expiresAt: new Date(until).toISOString(),
    productId,
  }
}

/** 購読者の今の Pro の状態。Webhook とアプリからの取り直し（sync-subscription）で同じ判定を使う */
export async function fetchProState(appUserId: string, secret: string, sandboxOk: boolean): Promise<ProState> {
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`RevenueCat subscriber fetch failed (${response.status})`)
  const body = await response.json() as { subscriber?: RCSubscriber }
  const entitlement = body.subscriber?.entitlements?.pro
  // 本番のイベントで取り直したときにも Sandbox の権利は混ざって返る。イベントの環境だけで
  // 弾いても、ここで数えれば Pro になってしまうので、権利の出どころで判定する
  if (!sandboxOk && isSandboxEntitlement(body.subscriber, entitlement)) {
    return { tier: 'free', expiresAt: null, productId: null }
  }
  return proStateFrom(entitlement, Date.now())
}
