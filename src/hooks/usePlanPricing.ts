import { PAYWALL_PLANS, PaywallPlanDef } from '../constants/plans'
import { useApp } from '../context/AppContext'
import { useSubscription } from '../context/SubscriptionContext'
import { findPackageForPlan, yearlyPriceNote } from '../utils/purchasePackages'

// plans.ts の price は日本のApp Storeの円価格を固定で持つだけなので、そのまま出すと
// 他の地域のユーザーに現地価格と違う金額を見せることになる（審査でも落ちる）。
// ストアから取得した実価格（priceString）を優先し、未取得のときだけ定数へ落とす。

export function usePlanPricing() {
  const { packages } = useSubscription()
  const { lang } = useApp()

  const priceOf = (plan: PaywallPlanDef): string =>
    findPackageForPlan(packages, plan)?.product?.priceString
    ?? (lang === 'en' ? plan.priceEn : plan.price)

  // 価格の下に添える補足。年額の「月あたり・お得」は価格と同じくストアの値から作る。
  // 定数へ落とすのは価格も定数へ落ちているとき（ストアの価格が取れていない）だけで、
  // そのときは予備の価格と予備の文言が同じ通貨で揃う
  const subOf = (plan: PaywallPlanDef): string => {
    const fallback = lang === 'en' ? plan.subEn : plan.subJa
    if (plan.id !== 'pro_yearly') return fallback
    const yearly = findPackageForPlan(packages, plan)?.product
    if (!yearly) return fallback
    const monthlyPlan = PAYWALL_PLANS.find((p) => p.id === 'pro_monthly')
    const monthly = monthlyPlan ? findPackageForPlan(packages, monthlyPlan)?.product : undefined
    return yearlyPriceNote(yearly, monthly, lang) ?? ''
  }

  return { priceOf, subOf }
}
