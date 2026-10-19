import type { PaywallPlanDef } from '../constants/plans'
import { RC_ENTITLEMENT_PRO } from '../constants/plans'
import { formatDate } from './dateFormat'

// RevenueCat の Package / CustomerInfo から、Paywall のプラン定義に対応する
// 商品を引くための照合ロジック。
//
// Android の StoreProduct.identifier と CustomerInfo.activeSubscriptions は
// Play Console の「サブスクID:基本プランID」形式（例 mydesk.pro.monthly:monthly）
// になり、こちらが .env に持っているサブスクIDと完全一致しない。
// iOS は素の商品IDのままなので、両方を扱えるよう ":" の手前だけを比較する。

type AnyPackage = any

export function resolveSubscriptionTier(
  revenueCatTier: 'free' | 'pro',
  hasCustomerInfo: boolean,
  profileTier?: string,
  officialDemoAccount = false,
): 'free' | 'pro' {
  // 公式デモの所有アカウントはストア契約を持たないが、見本データの運用では
  // Pro機能を使う。@MyDesk は予約済みなので一般ユーザーがこの分岐へ入ることはない。
  if (officialDemoAccount) return 'pro'
  // RevenueCatから現在の権利を取得できた後は、その結果を優先する。
  // DB側の古いProをORすると、失効・返金後もクライアント機能が解除されない。
  if (hasCustomerInfo) return revenueCatTier
  return profileTier === 'pro' ? 'pro' : 'free'
}

export function baseProductId(identifier?: string | null): string {
  return (identifier ?? '').split(':')[0]
}

// 商品IDが未設定（.env 空・EAS に env 未登録）でも Offering から引けるように、
// RevenueCat 標準パッケージの種別でもフォールバック照合する。
const PACKAGE_TYPE_BY_PLAN: Record<PaywallPlanDef['id'], string> = {
  pro_monthly: 'MONTHLY',
  pro_yearly:  'ANNUAL',
}

export function findPackageForPlan(
  packages: AnyPackage[],
  plan: PaywallPlanDef,
): AnyPackage | undefined {
  const wanted = baseProductId(plan.productId)
  if (wanted) {
    const hit = packages.find((p) => baseProductId(p?.product?.identifier) === wanted)
    if (hit) return hit
  }
  const type = PACKAGE_TYPE_BY_PLAN[plan.id]
  return packages.find((p) => p?.packageType === type)
}

/**
 * そのプランを契約中か。商品IDの環境変数が空でも購入はパッケージ種別で通るので、
 * 判定も購入側と同じ照合（findPackageForPlan）で引いた商品と突き合わせる。
 * 環境変数だけを見ると、買えたのに契約中のプランが分からない状態になる
 */
export function isPlanActive(customerInfo: any, plan: PaywallPlanDef, packages: AnyPackage[] = []): boolean {
  const wanted = new Set(
    [baseProductId(plan.productId), baseProductId(findPackageForPlan(packages, plan)?.product?.identifier)]
      .filter((id) => id !== ''),
  )
  if (wanted.size === 0) return false
  const active: string[] = customerInfo?.activeSubscriptions ?? []
  return active.some((id) => wanted.has(baseProductId(id)))
}

/**
 * 年額プランの補足（月あたりの額・月額との差）。ストアの実価格から作る。
 * 固定の文言だと、ストアの通貨や価格改定と食い違う（¥5,900 の下に $3.33 が並ぶ）。
 * どちらも作れなければ null
 */
export function yearlyPriceNote(yearly: any, monthly: any, lang: 'ja' | 'en'): string | null {
  const perMonth: string | null = yearly?.pricePerMonthString ?? null
  // 通貨が違う価格どうしは比べられない（ストアフロントが混ざることは無いはずだが、壊れた値で割引率を言わない）
  const comparable = monthly && yearly
    && monthly.currencyCode === yearly.currencyCode
    && monthly.price > 0 && yearly.price > 0
  const saving = comparable ? Math.round((1 - yearly.price / (monthly.price * 12)) * 100) : 0
  if (!perMonth && saving <= 0) return null
  if (lang === 'ja') {
    if (!perMonth) return `月額より${saving}%お得`
    return saving > 0 ? `月あたり ${perMonth}（${saving}%お得）` : `月あたり ${perMonth}`
  }
  if (!perMonth) return `Save ${saving}% vs monthly`
  return saving > 0 ? `${perMonth} / mo — save ${saving}%` : `${perMonth} / mo`
}

/**
 * プランカードに出す契約状態の 1 行。
 *
 * 期限が見えないと、解約したあといつまで使えるのか・トライアルがいつ課金に
 * 変わるのかが分からず、確かめる手段がストアの設定しか無くなる。
 * 権利が無い（Free）・期限を持たない情報のときは何も出さない。
 */
export function subscriptionStatusLabel(
  customerInfo: any,
  tier: 'free' | 'pro',
  lang: 'ja' | 'en',
): string | null {
  if (tier !== 'pro') return null
  const entitlement = customerInfo?.entitlements?.active?.[RC_ENTITLEMENT_PRO]
  const raw: string | null | undefined = entitlement?.expirationDate ?? customerInfo?.latestExpirationDate
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null

  const on = formatDate(date, lang)
  if (entitlement?.periodType === 'TRIAL') {
    return lang === 'ja' ? `無料トライアル中 · ${on} に課金開始` : `Free trial · billing starts ${on}`
  }
  // willRenew が未定義のときは更新される前提で読む（解約済みと誤って伝えない）
  if (entitlement?.willRenew === false) {
    return lang === 'ja' ? `${on} まで利用できます（自動更新オフ）` : `Access until ${on} · auto-renew off`
  }
  return lang === 'ja' ? `${on} に更新` : `Renews ${on}`
}
