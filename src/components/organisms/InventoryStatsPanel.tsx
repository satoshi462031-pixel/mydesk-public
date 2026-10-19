import { useMemo } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { BRANDS_ENABLED } from '../../constants/features'
import { categoryIconColor } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors, useApp } from '../../context/AppContext'
import { Gadget } from '../../types'
import { buildInventoryStats } from '../../utils/inventoryStats'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { SectionBoundary } from '../molecules/ErrorContainment'
import { HelpTipButton } from '../molecules/HelpTipButton'
import { CoachStep, useCoachTarget } from '../../hooks/useCoachMarks'

interface InventoryStatsPanelProps {
  gadgets: Gadget[]
  colors: AppColors
  t: (key: string, params?: Record<string, string | number>) => string
  lang: 'ja' | 'en'
  fmtPrice: (n: number | null | undefined) => string
  loading?: boolean
  onFillPrice?: () => void
}

function BreakdownRow({
  label,
  count,
  total,
  maxCount,
  colors,
  fmtPrice,
  suffix,
  leading,
}: {
  label: string
  count: number
  total: number
  maxCount: number
  colors: AppColors
  fmtPrice: (n: number | null | undefined) => string
  suffix: string
  leading?: React.ReactNode
}) {
  const width = maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0
  return (
    <View style={styles.breakdownRow}>
      <View style={styles.breakdownHead}>
        {leading}
        <Text style={[styles.breakdownLabel, { color: colors.text }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.breakdownCount, { color: colors.textMuted }]}>{count}{suffix}</Text>
        <Text style={[styles.breakdownAmount, { color: colors.text }]}>{fmtPrice(total)}</Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.chip }]}>
        <View style={[styles.barFill, { backgroundColor: colors.accent, width: `${width}%` }]} />
      </View>
    </View>
  )
}

function InventoryStatsPanelInner({ gadgets, colors, t, lang, fmtPrice, loading = false, onFillPrice }: InventoryStatsPanelProps) {
  const { isDark } = useApp()
  const stats = useMemo(() => buildInventoryStats(gadgets, lang), [gadgets, lang])
  const totalTarget = useCoachTarget('inv-total')
  const metricsTarget = useCoachTarget('inv-metrics')
  const categoryTarget = useCoachTarget('inv-category')
  const brandTarget = useCoachTarget('inv-brand')
  const yearTarget = useCoachTarget('inv-years')
  const fillTarget = useCoachTarget('inv-fill')
  const maxCategoryCount = Math.max(0, ...stats.categories.map((row) => row.count))
  const maxBrandCount = Math.max(0, ...stats.brands.map((row) => row.count))
  const maxYearCount = Math.max(0, ...stats.purchaseYears.map((row) => row.count))

  if (loading && gadgets.length === 0) {
    return (
      <ScrollView contentContainerStyle={[styles.scroll, styles.loadingBox]} showsVerticalScrollIndicator={false}>
        <ActivityIndicator color={colors.accentIcon} />
      </ScrollView>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={[styles.summaryCard, { backgroundColor: colors.accent + '18' }]}>
        <View style={styles.summaryHeading}>
          <Text style={[styles.summaryLabel, { color: colors.textSub }]}>{lang === 'ja' ? '持ち物の購入総額' : 'Total purchase amount'}</Text>
          <HelpTipButton steps={INVENTORY_AMOUNT_COACH} label={{ ja: '購入総額と点数の意味', en: 'Understanding purchase amounts and counts' }} />
        </View>
        <Text ref={totalTarget} style={[styles.summaryAmount, { color: colors.text }]}>{fmtPrice(stats.totalAmount)}</Text>
        <Text style={[styles.summaryCoverage, { color: colors.textMuted }]}>
          {lang === 'ja'
            ? `価格入力済み ${stats.pricedCount} / ${stats.itemCount}点`
            : `Prices entered for ${stats.pricedCount} / ${stats.itemCount} items`}
        </Text>
        <View ref={metricsTarget} style={styles.summaryMetrics}>
          <View style={styles.summaryMetric}>
            <Text style={[styles.summaryMetricValue, { color: colors.text }]}>{stats.itemCount}</Text>
            <Text style={[styles.summaryMetricLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '総点数' : 'Items'}</Text>
          </View>
          <View style={[styles.summaryMetric, styles.metricDivider, { borderLeftColor: colors.border }]}>
            <Text style={[styles.summaryMetricValue, { color: colors.text }]}>{stats.categories.length}</Text>
            <Text style={[styles.summaryMetricLabel, { color: colors.textMuted }]}>{lang === 'ja' ? 'ジャンル' : 'Categories'}</Text>
          </View>
          <View style={[styles.summaryMetric, styles.metricDivider, { borderLeftColor: colors.border }]}>
            <Text style={[styles.summaryMetricValue, { color: stats.unpricedCount > 0 ? colors.accentText : colors.text }]}>{stats.unpricedCount}</Text>
            <Text style={[styles.summaryMetricLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '価格未入力' : 'No price'}</Text>
          </View>
        </View>
      </View>

      <View ref={categoryTarget} style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>{lang === 'ja' ? 'ジャンル別' : 'By category'}</Text>
        {stats.categories.length > 0 ? stats.categories.map((row) => (
          <BreakdownRow
            key={row.key}
            label={t(`category.${row.key}`)}
            count={row.count}
            total={row.total}
            maxCount={maxCategoryCount}
            colors={colors}
            fmtPrice={fmtPrice}
            suffix={lang === 'ja' ? '点' : ''}
            leading={<CategoryIcon category={row.key} size={18} color={categoryIconColor(row.key, isDark, '#757575')} />}
          />
        )) : <Text style={[styles.empty, { color: colors.textMuted }]}>{lang === 'ja' ? '持ち物はまだありません' : 'No items yet'}</Text>}
      </View>

      {/* ブランドの分類を閉じている間は出さない（constants/features の BRANDS_ENABLED）。
          マイガジェットのブランド別だけ閉じて、ここが残っていた */}
      {BRANDS_ENABLED && (
      <View ref={brandTarget} style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>{lang === 'ja' ? 'ブランド別' : 'By brand'}</Text>
        {stats.brands.length > 0 ? stats.brands.map((row) => (
          <BreakdownRow
            key={row.key}
            label={row.label}
            count={row.count}
            total={row.total}
            maxCount={maxBrandCount}
            colors={colors}
            fmtPrice={fmtPrice}
            suffix={lang === 'ja' ? '点' : ''}
          />
        )) : <Text style={[styles.empty, { color: colors.textMuted }]}>{lang === 'ja' ? '持ち物はまだありません' : 'No items yet'}</Text>}
      </View>
      )}

      <View ref={yearTarget} style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textSub }]}>{lang === 'ja' ? '購入年別の推移' : 'Purchases by year'}</Text>
        {stats.purchaseYears.length > 0 ? stats.purchaseYears.map((row) => (
          <BreakdownRow
            key={row.key}
            label={lang === 'ja' ? `${row.key}年` : String(row.key)}
            count={row.count}
            total={row.total}
            maxCount={maxYearCount}
            colors={colors}
            fmtPrice={fmtPrice}
            suffix={lang === 'ja' ? '点' : ''}
          />
        )) : <Text style={[styles.empty, { color: colors.textMuted }]}>{lang === 'ja' ? '購入日を入力すると年別に集計します' : 'Add purchase dates to see yearly totals'}</Text>}
        {stats.undatedCount > 0 && (
          <Text style={[styles.note, { color: colors.textMuted }]}>
            {lang === 'ja' ? `購入日未入力 ${stats.undatedCount}点` : `${stats.undatedCount} items have no purchase date`}
          </Text>
        )}
      </View>

      {stats.unpricedCount > 0 && onFillPrice && (
        <TouchableOpacity
          ref={fillTarget}
          style={[styles.action, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={onFillPrice}
          activeOpacity={0.75}
          accessibilityRole="button"
        >
          <Text style={[styles.actionText, { color: colors.text }]}>
            {lang === 'ja' ? `価格未入力の持ち物が${stats.unpricedCount}点あります` : `${stats.unpricedCount} items have no price`}
          </Text>
          <Text style={[styles.actionLabel, { color: colors.accentText }]}>{lang === 'ja' ? '入力する' : 'Fill in'}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  )
}

// 総額の横の「？」は、総額と点数の意味だけを指す
const INVENTORY_AMOUNT_COACH: CoachStep[] = [
  { target: 'inv-total', title: { ja: '購入総額', en: 'Total purchase amount' }, emphasis: { ja: ['登録価格 × 数量', '価格を入れていない物'], en: ['registered price × quantity', 'Items without a price'] }, pad: 6, ja: '持ち物全体の「登録価格 × 数量」の合計です。デスクで使っていない機材やケーブルも含みます。価格を入れていない物は足していません。', en: 'The sum of registered price × quantity across everything you own, including unused gear and cables. Items without a price are not counted.' },
  { target: 'inv-metrics', title: { ja: '点数と価格未入力', en: 'Counts and missing prices' }, pad: 4, ja: '総点数は数量を含めた持ち物の数です。価格未入力は、価格を入れていない物の点数です。', en: 'Items counts everything you own, including quantities. No price counts items without a registered price.' },
]

// 統計画面の「？」。上から順に指す
export const INVENTORY_STATS_COACH: CoachStep[] = [
  ...INVENTORY_AMOUNT_COACH,
  { target: 'inv-category', title: { ja: 'ジャンル別', en: 'By category' }, ja: 'ジャンルごとの点数と金額です。棒の長さで点数を比べられます。', en: 'Counts and amounts by category. Bar lengths compare counts.' },
  { target: 'inv-brand', title: { ja: 'ブランド別', en: 'By brand' }, ja: 'ブランドごとの点数と金額です。ブランドは登録した商品名から判定しています。', en: 'Counts and amounts by brand, inferred from registered item names.' },
  { target: 'inv-years', title: { ja: '購入年ごと', en: 'Purchase years' }, ja: '購入日を入れた物だけを、買った年ごとに数えます。日付が無い物は下に別で出します。', en: 'Items with purchase dates, grouped by the year bought. Undated items are counted separately below.' },
  { target: 'inv-fill', title: { ja: '価格を入力', en: 'Fill in prices' }, pad: 4, ja: '価格を入れていない物があると出ます。入れると総額に加わります。', en: 'Shown when some items have no price. Adding prices includes them in the total.' },
]

const styles = StyleSheet.create({
  scroll: { padding: UI_METRICS.screenGutter, paddingBottom: 60 },
  loadingBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { borderRadius: UI_METRICS.cardRadius, paddingVertical: 24, paddingHorizontal: 14, alignItems: 'center', marginBottom: 20 },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { fontSize: 13, flexShrink: 1 },
  summaryAmount: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  summaryCoverage: { fontSize: 12, marginTop: 6 },
  summaryMetrics: { flexDirection: 'row', width: '100%', marginTop: 20 },
  summaryMetric: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  metricDivider: { borderLeftWidth: StyleSheet.hairlineWidth },
  summaryMetricValue: { fontSize: 17, fontWeight: '800' },
  summaryMetricLabel: { fontSize: 10, fontWeight: '600', marginTop: 3 },
  card: { borderRadius: UI_METRICS.cardRadius, padding: 14, marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', marginBottom: 12, letterSpacing: 0.3 },
  breakdownRow: { marginBottom: 14 },
  breakdownHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  breakdownLabel: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '700' },
  breakdownCount: { minWidth: 38, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  breakdownAmount: { minWidth: 82, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  barTrack: { height: 5, borderRadius: UI_METRICS.pillRadius, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: UI_METRICS.pillRadius },
  empty: { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingVertical: 20 },
  note: { fontSize: 11, textAlign: 'right', marginTop: 2 },
  action: { minHeight: 52, borderRadius: UI_METRICS.cardRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionText: { flex: 1, fontSize: 12, fontWeight: '600' },
  actionLabel: { fontSize: 13, fontWeight: '800' },
})

export function InventoryStatsPanel(props: InventoryStatsPanelProps) {
  return <SectionBoundary name="inventory_stats"><InventoryStatsPanelInner {...props} /></SectionBoundary>
}
