import { StyleSheet, Text, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { PAYWALL_PLANS, PLAN_COMPARE_ROWS, PlanCompareValue, PaywallPlanDef } from '../../constants/plans'
import { useApp } from '../../context/AppContext'
import { useSubscription } from '../../context/SubscriptionContext'
import { usePlanPricing } from '../../hooks/usePlanPricing'
import { isPlanActive } from '../../utils/purchasePackages'
import { UI_METRICS } from '../../constants/ui'

// ─── Free vs 有料プラン 比較（ChatGPT課金ページ風の2カラムカード）──
// 左に Free、右に選択中の有料プラン（Lite / Pro / Pro年額）のカードを並べ、
// 各カード内に「✓ 使える機能＋上限値」を縦に列挙。使えない機能はグレーの − で表示。
// Paywall（上部タブで切り替え）と 設定のプランモーダルで共用。

interface Props {
  paidPlan?: PaywallPlanDef      // 右カラムに表示する有料プラン（既定: Pro月額）
  currentTier?: 'free' | 'pro'   // 指定すると該当カードに「現在のプラン」を表示
}

function valueText(v: PlanCompareValue, lang: 'ja' | 'en'): string | null {
  if (typeof v === 'boolean') return null
  return lang === 'en' ? v.en : v.ja
}

function FeatureList({ tier, highlight }: { tier: 'free' | 'pro'; highlight: boolean }) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  return (
    <View style={{ gap: 9 }}>
      {PLAN_COMPARE_ROWS.map((row) => {
        const v = row[tier]
        const available = v !== false
        const val = valueText(v, lang)
        return (
          <View key={row.icon} style={s.featRow}>
            {available ? (
              <AppIcon name="check-circle" size={15} color={highlight ? C.accentIcon : C.textSub} />
            ) : (
              <AppIcon name="minus-circle-outline" size={15} color={C.textMuted} />
            )}
            <Text
              // 行数で切らない。英語の「Desk history animation  Unlimited」は列の幅だと3行になり、
              // 2行で切ると肝心の値（Unlimited）が消えていた。料金の比較なので値は必ず全部見せる
              style={[s.featText, { color: available ? C.text : C.textMuted }]}
            >
              {ja ? row.ja : row.en}
              {val ? <Text style={{ fontWeight: '800', color: available ? (highlight ? C.accentText : C.textSub) : C.textMuted }}>{`  ${val}`}</Text> : null}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export function PlanComparisonTable({ paidPlan, currentTier }: Props) {
  const { colors: C, lang } = useApp()
  const { priceOf, subOf } = usePlanPricing()
  const { customerInfo, packages } = useSubscription()
  const accent = C.accent
  const ja = lang === 'ja'
  const plan = paidPlan ?? PAYWALL_PLANS.find((p) => p.id === 'pro_monthly')!
  const paidPrice = priceOf(plan)
  // 「現在のプラン」は契約中の商品のタブにだけ出す。Pro かどうかだけで出すと、月額の人が
  // 年額タブを開いても年額が現在のプランに見える。どの商品か引き当てられない権利
  // （プロモーション付与など）のときだけ、どのタブでも出す
  const matchedPlanKnown = PAYWALL_PLANS.some((p) => isPlanActive(customerInfo, p, packages))
  const isCurrentPaidPlan = currentTier === 'pro'
    && (matchedPlanKnown ? isPlanActive(customerInfo, plan, packages) : true)
  // Free の「0」は有料プランと同じ通貨で出す。StoreKit が返す価格は端末の
  // ストアフロント依存なので、記号を固定すると $3.99 の隣に ¥0 が並ぶ
  const freePrice = paidPrice.replace(/[\d.,]+/, '0')

  return (
    <View style={s.rowWrap}>
      {/* ── Free ── */}
      <View style={[s.card, { backgroundColor: C.card, borderColor: C.separator, borderWidth: 1 }]}>
        <Text style={[s.planName, { color: C.text }]}>Free</Text>
        <Text style={[s.price, { color: C.text }]}>{freePrice}</Text>
        <Text style={[s.priceSub, { color: C.textMuted }]}>{ja ? 'ずっと無料' : 'Free forever'}</Text>
        {currentTier === 'free' ? (
          <View style={[s.currentChip, { backgroundColor: C.chip }]}>
            <Text style={[s.currentChipText, { color: C.textSub }]}>{ja ? '現在のプラン' : 'Current plan'}</Text>
          </View>
        ) : (
          <View style={s.currentSpacer} />
        )}
        <View style={[s.divider, { backgroundColor: C.separator }]} />
        <FeatureList tier="free" highlight={false} />
      </View>

      {/* ── 選択中の有料プラン ── */}
      <View style={[s.card, { backgroundColor: C.card, borderColor: accent, borderWidth: 2 }]}>
        {plan.badgeJa && (
          <View style={[s.ribbon, { backgroundColor: accent }]}>
            <Text style={[s.ribbonText, { color: C.onAccent }]}>{ja ? plan.badgeJa : plan.badgeEn}</Text>
          </View>
        )}
        <Text style={[s.planName, { color: C.accentText }]}>{ja ? plan.nameJa : plan.nameEn}</Text>
        <Text style={[s.price, { color: C.text }]}>
          {paidPrice}
          <Text style={[s.priceUnit, { color: C.textMuted }]}>{ja ? ` ${plan.periodJa}` : ` ${plan.periodEn}`}</Text>
        </Text>
        <Text style={[s.priceSub, { color: C.textMuted }]} numberOfLines={2}>
          {plan.trialJa
            ? (ja ? plan.trialJa : plan.trialEn)
            : subOf(plan)}
        </Text>
        {isCurrentPaidPlan ? (
          <View style={[s.currentChip, { backgroundColor: accent }]}>
            <Text style={[s.currentChipText, { color: C.onAccent }]}>{ja ? '現在のプラン' : 'Current plan'}</Text>
          </View>
        ) : (
          <View style={s.currentSpacer} />
        )}
        <View style={[s.divider, { backgroundColor: C.separator }]} />
        <FeatureList tier={plan.tier} highlight />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  rowWrap: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },

  card: {
    flex: 1,
    borderRadius: UI_METRICS.cardRadius,
    padding: 14,
    paddingTop: 18,
  },
  ribbon: {
    position: 'absolute',
    top: -1,
    right: 12,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  ribbonText: { fontSize: 10, fontWeight: '800' },

  planName: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
  price:    { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  priceUnit:{ fontSize: 12, fontWeight: '600' },
  priceSub: { fontSize: 10.5, marginTop: 2, minHeight: 28 },

  currentChip: { alignSelf: 'flex-start', borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  currentChipText: { fontSize: 10, fontWeight: '700' },
  currentSpacer: { height: 20, marginTop: 4 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },

  featRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  featText: { flex: 1, fontSize: 11.5, lineHeight: 16, fontWeight: '500' },
})
