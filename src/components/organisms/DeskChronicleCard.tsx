import { useMemo, useRef, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import { Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { SegmentedControl } from '../atoms/SegmentedControl'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors, useApp } from '../../context/AppContext'
import { Gadget } from '../../types'
import {
  buildChronicle,
  ChronicleRow,
  ChronicleStrip,
  estimateTextWidth,
  formatChronicleDuration,
  layoutChronicleStrip,
} from '../../utils/gadgetChronicle'
import { localizedGadgetName } from '../../utils/localizedGadgetName'

const AXIS_H = 20
const LANE_H = 28
const BAR_H = 22
const LABEL_FONT = 11
const LABEL_ICON = 12
const LABEL_PAD = 6
const LABEL_ICON_GAP = 4
// 名前が長い機材1台で段が横に伸びきらないよう、名前の幅に上限を置いて省略する
const MAX_LABEL_W = 160
const INITIAL_LANES = 5
// 右端の「今」ラベルと重なる距離にある目盛りのラベルは出さない
const NOW_LABEL_ROOM = 28

type ChronicleFilter = 'all' | 'active' | 'retired'

interface Props {
  /** 撤去済みを含むガジェット。退役したものが残るのがこの表の主旨 */
  gadgets: Gadget[]
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  /** 遡れる年数（-1 = 全期間）。歴史アニメーションと同じ `historyAnimationYears` を渡す */
  windowYears: number
  /** Free で窓の外に履歴があるときに押される */
  onRequirePro?: () => void
}

const ymLabel = (ms: number, lang: 'ja' | 'en'): string => {
  const d = new Date(ms)
  return lang === 'ja'
    ? `${d.getFullYear()}年${d.getMonth() + 1}月`
    : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const tickLabel = (date: Date, grain: 'year' | 'month', lang: 'ja' | 'en'): string => {
  if (grain === 'year') return `${date.getFullYear()}`
  return lang === 'ja' ? `${date.getMonth() + 1}月` : date.toLocaleDateString('en-US', { month: 'short' })
}

const labelWidthOf = (row: ChronicleRow, lang: 'ja' | 'en'): number => Math.min(
  MAX_LABEL_W,
  LABEL_PAD * 2 + LABEL_ICON + LABEL_ICON_GAP + estimateTextWidth(localizedGadgetName(row.gadget, lang), LABEL_FONT),
)

interface ChronicleStripViewProps {
  strip: ChronicleStrip
  visibleLanes: number
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
}

function ChronicleStripView({ strip, visibleLanes, colors, lang, isDark }: ChronicleStripViewProps) {
  const ja = lang === 'ja'
  const scrollRef = useRef<ScrollView>(null)
  const scrolledForWidthRef = useRef(0)

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      // 開いたときは今（右端）から見せる。昔へは左へ遡る
      onContentSizeChange={(w) => {
        if (Math.abs(scrolledForWidthRef.current - w) < 0.5) return
        scrolledForWidthRef.current = w
        scrollRef.current?.scrollToEnd({ animated: false })
      }}
    >
      <View style={{ width: strip.contentWidth, height: AXIS_H + visibleLanes * LANE_H }}>
        {strip.ticks.map((tick) => (
          <View
            key={`line-${tick.x}`}
            pointerEvents="none"
            style={[
              styles.tickLine,
              tick.grain === 'year' ? styles.tickLineYear : styles.tickLineMonth,
              { left: tick.x, backgroundColor: colors.separator },
            ]}
          />
        ))}
        {strip.ticks
          .filter((tick) => tick.x < strip.timelineWidth - NOW_LABEL_ROOM)
          .map((tick) => (
            <Text
              key={`label-${tick.x}`}
              style={[
                tick.grain === 'year' ? styles.yearLabel : styles.monthLabel,
                { left: tick.x + 3, color: tick.grain === 'year' ? colors.textSub : colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {tickLabel(tick.date, tick.grain, lang)}
            </Text>
          ))}
        <View pointerEvents="none" style={[styles.nowLine, { left: strip.timelineWidth - 1, backgroundColor: colors.accent }]} />
        <Text style={[styles.nowLabel, { left: strip.timelineWidth - 4 - NOW_LABEL_ROOM, color: colors.accentText }]}>
          {ja ? '今' : 'Now'}
        </Text>

        {strip.bands.filter((band) => band.lane < visibleLanes).map((band) => {
          const { row } = band
          const catColor = categoryIconColor(row.gadget.category, isDark, '#757575', row.gadget.customCategory?.color)
          const duration = formatChronicleDuration(row.totalDays, lang)
          const lastSpan = row.spans[row.spans.length - 1]
          const gadgetName = localizedGadgetName(row.gadget, lang)
          // 帯に名前と期間の両方が収まるときだけ期間も書く。収まらない帯は読み上げで伝える
          const durationW = estimateTextWidth(`  ${duration}`, LABEL_FONT)
          const showDuration = band.barRight - band.labelX >= band.labelWidth + durationW && band.labelWidth < MAX_LABEL_W
          return (
            <View
              key={row.gadget.id}
              style={[styles.band, { left: band.left, width: band.right - band.left, top: AXIS_H + band.lane * LANE_H }]}
              accessible
              accessibilityLabel={ja
                ? `${gadgetName}、${ymLabel(row.firstStartMs, lang)}から${row.ongoing ? '現在まで' : `${ymLabel(lastSpan.endMs, lang)}まで`}、${duration}`
                : `${gadgetName}, ${ymLabel(row.firstStartMs, lang)} to ${row.ongoing ? 'now' : ymLabel(lastSpan.endMs, lang)}, ${duration}`}
            >
              {band.spans.map((span) => (
                <View
                  key={`${span.x}-${span.width}`}
                  style={[styles.bar, {
                    left: span.x - band.left,
                    width: span.width,
                    // 退役ぶんは色を抜いて「あった」ことだけ残す
                    backgroundColor: span.ongoing ? catColor + '33' : colors.chip,
                    // 窓の外から続いている期間は左端を角丸にせず、切れていることを示す
                    borderTopLeftRadius: span.clippedStart ? 0 : BAR_H / 2,
                    borderBottomLeftRadius: span.clippedStart ? 0 : BAR_H / 2,
                  }]}
                />
              ))}
              <View
                style={[styles.label, {
                  left: band.labelX - band.left,
                  width: showDuration ? band.labelWidth + durationW : band.labelWidth,
                }]}
              >
                <CategoryIcon category={row.gadget.category} pcFormFactor={row.gadget.pcFormFactor} customIcon={row.gadget.customCategory?.icon} size={LABEL_ICON} color={catColor} />
                <Text
                  style={[styles.labelText, { color: row.ongoing ? colors.text : colors.textSub }]}
                  numberOfLines={1}
                >
                  {gadgetName}
                  {showDuration && <Text style={{ color: colors.textMuted }}>{`  ${duration}`}</Text>}
                </Text>
              </View>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

/**
 * デスク年表。歴史年表の「時代」の帯のように、ガジェットごとの在籍期間を横へ流して並べる。
 * 「デスクの成長」の折れ線が増えた量を示すのに対し、こちらは退役した機材も
 * 同じ画面に残して、入れ替わりの歴史そのものを見せる。
 */
export function DeskChronicleCard({ gadgets, colors, lang, isDark, windowYears, onRequirePro }: Props) {
  const { reduceMotion } = useApp()
  const ja = lang === 'ja'
  const [innerW, setInnerW] = useState(0)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailFilter, setDetailFilter] = useState<ChronicleFilter>('all')
  const [detailW, setDetailW] = useState(0)

  const today = useToday()
  const chronicle = useMemo(() => buildChronicle(gadgets, { windowYears, now: today }), [gadgets, windowYears, today])
  const { rows, activeCount, retiredCount, hiddenCount, earliestMs, undatedCount } = chronicle

  const strip = useMemo(() => {
    if (innerW <= 0) return null
    return layoutChronicleStrip(chronicle, { minWidth: innerW, labelWidthOf: (row) => labelWidthOf(row, lang) })
  }, [chronicle, innerW, lang])

  const detailRows = useMemo(() => rows.filter((row) => {
    if (detailFilter === 'active') return row.ongoing
    if (detailFilter === 'retired') return !row.ongoing
    return true
  }), [detailFilter, rows])

  const detailStrip = useMemo(() => {
    if (detailW <= 0 || detailRows.length === 0) return null
    return layoutChronicleStrip(
      { ...chronicle, rows: detailRows },
      { minWidth: detailW, labelWidthOf: (row) => labelWidthOf(row, lang) },
    )
  }, [chronicle, detailRows, detailW, lang])

  const visibleLanes = strip ? Math.min(strip.laneCount, INITIAL_LANES) : 0
  const restCount = strip ? strip.bands.filter((band) => band.lane >= visibleLanes).length : 0
  const scrollable = strip != null && strip.contentWidth > innerW + 1
  const lockedBehind = windowYears >= 0 && earliestMs != null && (earliestMs < chronicle.windowStartMs || hiddenCount > 0)
  const noteText = [
    scrollable ? (ja ? '左へスクロールすると昔へ遡れます' : 'Scroll left to go back in time') : null,
    undatedCount > 0 && rows.length > 0
      ? (ja
        ? `購入日が未入力の${undatedCount}台は年表に出ていません`
        : `${undatedCount} gadget${undatedCount === 1 ? '' : 's'} without a purchase date are not shown`)
      : null,
  ].filter((text): text is string => !!text).join(ja ? ' ・ ' : ' · ')

  const detailFilters: { key: ChronicleFilter; label: string; count: number }[] = [
    { key: 'all', label: ja ? 'すべて' : 'All', count: rows.length },
    { key: 'active', label: ja ? '在籍中' : 'Active', count: activeCount },
    { key: 'retired', label: ja ? '退役' : 'Retired', count: retiredCount },
  ]

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.textSub }]}>{ja ? 'デスク年表' : 'Desk Chronicle'}</Text>
        {rows.length > 0 && (
          <View style={styles.headChips}>
            {/* 面は '18'。これより濃いと上の accentText が AA を割る */}
            <View style={[styles.chip, { backgroundColor: colors.accent + '18' }]}>
              <Text style={[styles.chipText, { color: colors.accentText }]}>
                {ja ? `在籍中 ${activeCount}` : `Active ${activeCount}`}
              </Text>
            </View>
            {retiredCount > 0 && (
              <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                <Text style={[styles.chipText, { color: colors.textMuted }]}>
                  {ja ? `退役 ${retiredCount}` : `Retired ${retiredCount}`}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>
          {/* 日付が無いのか、表示できる期間の外なのかで案内を分ける。
              一律に「購入日を入力すると」と出すと、入力済みの人が入力し直そうとする */}
          {earliestMs != null
            ? (ja
              ? '表示できる期間に在籍していたガジェットがありません'
              : 'No gadgets were on the desk during this period')
            : (ja
              ? '購入日を入力すると、ガジェットごとの在籍期間が年表になります'
              : 'Add purchase dates to see how long each gadget has been on your desk')}
        </Text>
      ) : (
        <View onLayout={(e) => {
          const w = e.nativeEvent.layout.width
          setInnerW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w))
        }}>
          {strip && <ChronicleStripView strip={strip} visibleLanes={visibleLanes} colors={colors} lang={lang} isDark={isDark} />}

          {strip && (
            <TouchableOpacity
              style={[styles.detailBtn, { borderColor: colors.border }]}
              onPress={() => setDetailOpen(true)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={ja ? 'デスク年表を詳しく見る' : 'View desk chronicle details'}
            >
              <Text style={[styles.detailBtnText, { color: colors.accentText }]}>
                {ja
                  ? `年表を詳しく見る${restCount > 0 ? `（ほか${restCount}台）` : ''}`
                  : `View details${restCount > 0 ? ` (${restCount} more)` : ''}`}
              </Text>
              <AppIcon name={ICONS.chevronRight} size={17} color={colors.accentText} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {!!noteText && (
        <Text style={[styles.note, { color: colors.textMuted }]}>
          {noteText}
        </Text>
      )}

      {lockedBehind && (
        <TouchableOpacity
          style={[styles.lock, { backgroundColor: colors.accent + '14', borderColor: colors.accent + '4D' }]}
          onPress={onRequirePro}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={ja ? 'Proで全期間の年表を見る' : 'View the full chronicle with Pro'}
        >
          <AppIcon name="crown-outline" size={20} color={colors.pro} />
          <View style={styles.lockBody}>
            <Text style={[styles.lockTitle, { color: colors.text }]}>
              {ja
                ? `${earliestMs != null ? ymLabel(earliestMs, lang) : ''}からの全期間を見る`
                : `See the full history from ${earliestMs != null ? ymLabel(earliestMs, lang) : ''}`}
            </Text>
            <Text style={[styles.lockText, { color: colors.textMuted }]}>
              {hiddenCount > 0
                ? (ja
                  ? `直近${windowYears}年より前に退役した${hiddenCount}台は Pro で表示されます`
                  : `${hiddenCount} gadget${hiddenCount === 1 ? '' : 's'} retired earlier are available on Pro`)
                : (ja
                  ? `直近${windowYears}年より前はProで表示されます`
                  : `History older than ${windowYears} year${windowYears === 1 ? '' : 's'} is available on Pro`)}
            </Text>
          </View>
          <AppIcon name={ICONS.chevronRight} size={20} color={colors.accentText} />
        </TouchableOpacity>
      )}
      </View>

      <Modal
        visible={detailOpen}
        animationType={reduceMotion ? 'fade' : 'slide'}
        presentationStyle="fullScreen"
        onRequestClose={() => setDetailOpen(false)}
      >
        <SafeAreaView style={[styles.detailScreen, { backgroundColor: colors.bg }]}>
          <View style={[styles.detailHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={styles.detailClose}
              onPress={() => setDetailOpen(false)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={ja ? '閉じる' : 'Close'}
            >
              <AppIcon name={ICONS.close} size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.detailTitle, { color: colors.text }]}>{ja ? 'デスク年表' : 'Desk Chronicle'}</Text>
            <View style={styles.detailHeaderSpacer} />
          </View>

          <SegmentedControl
            options={detailFilters.map((filter) => ({
              key: filter.key,
              label: `${filter.label} ${filter.count}`,
            }))}
            value={detailFilter}
            onChange={setDetailFilter}
            style={styles.filterTrack}
          />

          <ScrollView
            style={styles.detailScroll}
            contentContainerStyle={styles.detailContent}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={styles.detailTimeline}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width
                setDetailW((prev) => (Math.abs(prev - w) < 0.5 ? prev : w))
              }}
            >
              {detailStrip ? (
                <ChronicleStripView
                  strip={detailStrip}
                  visibleLanes={detailStrip.laneCount}
                  colors={colors}
                  lang={lang}
                  isDark={isDark}
                />
              ) : (
                <Text style={[styles.detailEmpty, { color: colors.textMuted }]}>
                  {ja ? '該当するガジェットはありません' : 'No matching gadgets'}
                </Text>
              )}
            </View>

            {!!noteText && <Text style={[styles.detailNote, { color: colors.textMuted }]}>{noteText}</Text>}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: UI_METRICS.cardRadius, padding: 16, marginBottom: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '700' },
  headChips: { flexDirection: 'row', gap: 6 },
  chip: { borderRadius: UI_METRICS.chipRadius, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: '700' },
  empty: { fontSize: 13, lineHeight: 19 },
  tickLine: { position: 'absolute', width: StyleSheet.hairlineWidth },
  tickLineYear: { top: 0, bottom: 0 },
  tickLineMonth: { top: AXIS_H - 6, bottom: 0, opacity: 0.5 },
  yearLabel: { position: 'absolute', top: 1, fontSize: 12, fontWeight: '700' },
  monthLabel: { position: 'absolute', top: 3, fontSize: 10, fontWeight: '600' },
  nowLine: { position: 'absolute', top: 0, bottom: 0, width: 1 },
  nowLabel: { position: 'absolute', top: 2, width: NOW_LABEL_ROOM, fontSize: 11, fontWeight: '700', textAlign: 'right' },
  band: { position: 'absolute', height: LANE_H },
  bar: { position: 'absolute', top: (LANE_H - BAR_H) / 2, height: BAR_H, borderRadius: BAR_H / 2 },
  label: {
    position: 'absolute', top: (LANE_H - BAR_H) / 2, height: BAR_H,
    flexDirection: 'row', alignItems: 'center', gap: LABEL_ICON_GAP, paddingHorizontal: LABEL_PAD,
  },
  labelText: { flexShrink: 1, fontSize: LABEL_FONT, fontWeight: '600' },
  detailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: UI_METRICS.touchMinSize, marginTop: 8, paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.controlRadius,
  },
  detailBtnText: { fontSize: 13, fontWeight: '700' },
  note: { fontSize: 11, marginTop: 10 },
  lock: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 12, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.controlRadius,
  },
  lockBody: { flex: 1 },
  lockTitle: { fontSize: 13, fontWeight: '700' },
  lockText: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  detailScreen: { flex: 1 },
  detailHeader: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailClose: {
    width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize,
    alignItems: 'center', justifyContent: 'center', marginLeft: 4,
  },
  detailHeaderSpacer: { width: UI_METRICS.touchMinSize, marginRight: 4 },
  detailTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  filterTrack: { marginHorizontal: 16, marginTop: 12 },
  detailScroll: { flex: 1 },
  detailContent: { paddingTop: 18, paddingBottom: 32 },
  detailTimeline: { marginHorizontal: 16, minHeight: AXIS_H + LANE_H },
  detailEmpty: { paddingVertical: 40, textAlign: 'center', fontSize: 13 },
  detailNote: { marginHorizontal: 16, marginTop: 12, fontSize: 11 },
})
